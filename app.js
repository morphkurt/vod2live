const express = require('express')
const fetch = require('node-fetch');
const HLS = require('hls-parser'); // For node
const app = express()

/*
ffmpeg -stream_loop -1 -i background.png -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -pix_fmt yuv420p -vcodec libx264 -t 300 -f hls -hls_time 6 -hls_init_time 0  -force_key_frames "expr:gte(t,n_forced*2)" -hls_playlist_type vod stream_starting_.m3u8
ffmpeg -stream_loop -1 -i background.png -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -pix_fmt yuv420p -vcodec libx264 -t 300 -f hls -hls_time 6 -hls_init_time 0  -force_key_frames "expr:gte(t,n_forced*2)" -hls_playlist_type vod stream_ended_.m3u8
ffmpeg  -i 5mincountdown.mov -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -pix_fmt yuv420p -vcodec libx264 -t 300 -f hls -hls_time 6 -hls_init_time 0  -force_key_frames "expr:gte(t,n_forced*2)" -hls_playlist_type vod segment_.m3u8

*/

function addCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    res.setHeader('Access-Control-Allow-Credentials', true)
    res.setHeader('Last-Modified', (new Date()).toUTCString());
}

const PORT = process.env.PORT || 3000;
const DEBUG = (process.env.DEBUG == 'true') || true;
const countdown = Number(process.env.COUNTDOWN) || 1800;
const segmentLength = Number(process.env.SEGMENTLENGTH) || 6;
const epochstart = Number(process.env.EPOCHSTART) || 1588514400;
const preSlidePath = process.env.PRESLIDEPATH || "pre_slide";
const postSlidePath = process.env.POSTSLIDEPATH || "post_slide";
const countDownPath = process.env.COUNTDOWNPATH || "5mincount";
const preSlideSegments = Number(process.env.PRESLIDESEGMENTS) || 10;
const postSlideSegments = Number(process.env.POSTSLIDESEGMENTS) || 10;
const liveWindow = Number(process.env.LIVEWINDOW) || 60;
var domain = process.env.ORIGIN || 'https://vod1.syd2.vhe.telstra.com'
var slideDomain = process.env.SLIDEDOMAIN || 'http://192.168.88.203:8080'

app.get('*/index.m3u8', (req, res) => {
    addCors(res);
    fetch(domain + req.path)
        .then(response => response.text())
        .then(body => {
            if(req.query.starttime) {
                res.write(injectQuery(body, `starttime=${req.query.starttime}`))
            } else {
                res.write(body)
            }
            res.end();
        })
        .catch(err => console.log(err));
});

function injectQuery(body, query) {

    var re = new RegExp('m3u8', 'g');
    str = body.replace(re, `m3u8?${query}`);
    return str
}

function generatePlayList(data, startTime, currentTime, segmentLength, liveWindow, path) {
    const playlist = HLS.parse(data);
    let liveWindowStartTime = currentTime - liveWindow;
    let elapsedTime = 0;
    let outSegments = [];
    let discontinuityFound = false;
    const { MediaPlaylist, Segment } = HLS.types;

    let outplaylist = new MediaPlaylist({
        mediaSequenceBase: Math.floor((currentTime - epochstart) / segmentLength),
        targetDuration: segmentLength + 1,
        playlistType: 'LIVE',
    });


    while (elapsedTime < liveWindow) {
        // segment is before live event start time, preslide required.
        if (((liveWindowStartTime + elapsedTime) - startTime) < 0) {
            if (((liveWindowStartTime + elapsedTime) - startTime) < -countdown) {
                let segmentNo = Math.floor(((liveWindowStartTime + elapsedTime) - epochstart) / segmentLength % preSlideSegments)
                outSegments.push(new Segment({
                    uri: `${slideDomain}/${preSlidePath}/segment_${segmentNo}.ts`,
                    duration: segmentLength,
                    discontinuity: (segmentNo == 0)
                }))
            } else {
                let segmentNo = Math.floor(((((liveWindowStartTime + elapsedTime) - (startTime - countdown)) / segmentLength)) % (countdown / segmentLength))
                outSegments.push(new Segment({
                    uri: `${slideDomain}/${countDownPath}/segment_${segmentNo}.ts`,
                    duration: segmentLength,
                    discontinuity: (segmentNo == 0)
                }))
            }
        }
        else if (Math.floor(((liveWindowStartTime + elapsedTime) - startTime) / segmentLength) > playlist.segments.length) {
            let segmentNo = Math.floor(((liveWindowStartTime + elapsedTime) - epochstart) / segmentLength % postSlideSegments)
            outSegments.push(new Segment({
                uri: `${slideDomain}/${postSlidePath}/segment_${segmentNo}.ts`,
                duration: segmentLength,
                discontinuity: discontinuityFound || (segmentNo == 0)
            }))
            discontinuityFound = false;

        }
        else if (Math.floor(((liveWindowStartTime + elapsedTime) - startTime) / segmentLength) < playlist.segments.length) {
            let segmentNo = Math.floor(((liveWindowStartTime + elapsedTime) - startTime) / segmentLength)
            //      console.log(segmentNo);
            discontinuityFound = true;
            outSegments.push(new Segment({

                uri: `${domain}${path}/${playlist.segments[segmentNo].uri}`,
                duration: playlist.segments[segmentNo].duration,
                discontinuity: (segmentNo == 0)
            }))
        }
        elapsedTime += segmentLength;
    }
    outplaylist.segments = outSegments;
    return HLS.stringify(outplaylist);

}

app.get('*/*.m3u8', (req, res) => {
    const regex = /([\/\w]+)\/([\w-]+.m3u8)/s;
    let path = req.path.match(regex)[1]
    addCors(res);
    res.setHeader('Cache-Control', 'max-age=2')
    let q1 = {};
    let currentTime = Math.round(Date.now() / 1000)
    let startTime = Number(req.query.starttime)
    let duration = currentTime - startTime;
    q1['starttime'] = req.query.starttime;

    fetch(domain + req.path)
        .then(response => response.text())
        .then(body => {

            res.write(generatePlayList(body, startTime, currentTime, segmentLength, liveWindow, path))
            res.end();
            //   console.log(vod2live(body))
        })
        .catch(err => console.log(err));
});




app.listen(PORT, () => console.log(`Example app listening on port ${PORT}!`))