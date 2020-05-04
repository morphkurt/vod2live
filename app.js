const express = require('express')
const fetch = require('node-fetch');
const HLS = require('hls-parser'); // For node
const app = express()

function addCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    res.setHeader('Access-Control-Allow-Credentials', true)
    res.setHeader('Last-Modified', (new Date()).toUTCString());
}

const PORT = process.env.PORT || 3000;
const DEBUG = (process.env.DEBUG == 'true') || true;


var domain = process.env.ORIGIN || 'https://afl-vod-multi-001-uptls.akamaized.net'
var CDNdomain = process.env.ORIGIN || 'http://vod1.syd2.vhe.telstra.com'

var slideDomain = process.env.SLIDEDOMAIN || 'http://192.168.88.203:8080'

app.get('*/index.m3u8', (req, res) => {
    addCors(res);
    let q1 = {};
    q1['starttime'] = req.query.starttime;
    fetch(domain + req.path)
        .then(response => response.text())
        .then(body => {
            res.write(injectQuery(body, `starttime=${req.query.starttime}`))
            res.end();
            //      console.log(injectQuery(body, `starttime=${req.query.starttime}`))
        })
        .catch(err => console.log(err));
});

function injectQuery(body, query) {

    var re = new RegExp('m3u8', 'g');
    str = body.replace(re, `m3u8?${query}`);
    return str
}

function generatePlayList(data, startTime, currentTime, segmentLength, liveWindow,path) {
    const playlist = HLS.parse(data);
    let liveWindowStartTime = currentTime - liveWindow;
    let elapsedTime = 0;
    let outSegments = [];
    let discontinuityFound = false;
    const { MediaPlaylist, Segment } = HLS.types;

    let outplaylist = new MediaPlaylist({
        mediaSequenceBase: Math.floor((currentTime - 1588514400) / 6),
        targetDuration: segmentLength + 1,
        playlistType: 'LIVE',
    });


    while (elapsedTime < liveWindow) {
        // segment is before live event start time, preslide required.
        if (((liveWindowStartTime + elapsedTime) - startTime) < 0) {
            if (((liveWindowStartTime + elapsedTime) - startTime) < 0) {
                let segmentNo = Math.floor(((liveWindowStartTime + elapsedTime) - 1588514400) / 6 % 10)
                outSegments.push(new Segment({
                    uri: `${slideDomain}/pre_slide/stream_starting_${segmentNo}.ts`,
                    duration: segmentLength,
                    discontinuity: (segmentNo == 0)
                }))
            } else {
                let segmentNo = Math.floor((liveWindowStartTime + elapsedTime) / 6) % 50
                outSegments.push(new Segment({
                    uri: `${slideDomain}/5mincount/stream_starting_count_${segmentNo}.ts`,
                    duration: segmentLength,
                    discontinuity: (segmentNo == 0)
                }))
            }
        }
        else if (Math.floor(((liveWindowStartTime + elapsedTime) - startTime) / 6) > playlist.segments.length) {
            let segmentNo = Math.floor(((liveWindowStartTime + elapsedTime) - 1588514400) / 6 % 10)
            outSegments.push(new Segment({
                uri: `${slideDomain}/post_slide/stream_ended_${segmentNo}.ts`,
                duration: segmentLength,
                discontinuity: discontinuityFound || (segmentNo == 0)
            }))
            discontinuityFound = false;

        }
        else if (Math.floor(((liveWindowStartTime + elapsedTime) - startTime) / 6) < playlist.segments.length) {
            let segmentNo = Math.floor(((liveWindowStartTime + elapsedTime) - startTime) / 6)
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

            res.write(generatePlayList(body, startTime, currentTime, 6, 60, path))
            res.end();
            //   console.log(vod2live(body))
        })
        .catch(err => console.log(err));
});




app.listen(PORT, () => console.log(`Example app listening on port ${PORT}!`))