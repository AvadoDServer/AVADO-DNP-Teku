import * as restify from "restify";
import corsMiddleware from "restify-cors-middleware2"
import axios, { Method } from "axios";
import * as fs from 'fs';

import {server_config} from "./server_config";
import defaultsettings from "./settings/defaultsettings.json";

console.log("Monitor starting...");

const server = restify.createServer({
    name: "MONITOR",
    version: "1.0.0"
});

const cors = corsMiddleware({
    preflightMaxAge: 5, //Optional
    origins: [
        /^http:\/\/localhost(:[\d]+)?$/,
        "http://*.dappnode.eth",
        "http://*.my.ava.do"
    ]
});

server.pre(cors.preflight);
server.use(cors.actual);
server.use(restify.plugins.bodyParser());

const settings_file_path = '/data/settings.json';

server.get("/ping", (req: restify.Request, res: restify.Response, next: restify.Next) => {
    res.send(200, "pong");
    next()
});

server.get("/network", (req: restify.Request, res: restify.Response, next: restify.Next) => {
    res.send(200, server_config.network);
    next()
});

server.get("/name", (req: restify.Request, res: restify.Response, next: restify.Next) => {
    res.send(200, server_config.name);
    next()
});

server.get("/settings", (req: restify.Request, res: restify.Response, next: restify.Next) => {
    try {
        const settings = JSON.parse(fs.readFileSync(settings_file_path, 'utf8'))
        res.send(200, settings ? JSON.stringify(settings) : defaultsettings );
        next()
    } catch (err) {
        res.send(200, defaultsettings);
        next();
    }
});

server.post("/settings", (req: restify.Request, res: restify.Response, next: restify.Next) => {
        const settings = JSON.stringify(req.body, null, 4);
        fs.writeFileSync(settings_file_path, settings, 'utf8');
        res.send(200, `Saved settings`);
        return next();
});

server.get("/defaultsettings", (req: restify.Request, res: restify.Response, next: restify.Next) => {
    try {
        res.send(200, defaultsettings);
        next()
    } catch (err) {
        res.send(200, "failed")
        next();
    }
});

// checkpoints APIs
server.get("/:name/checkpointz/v1/beacon/slots/:slot", (req: restify.Request, res: restify.Response, next: restify.Next) => {
    const slot = req.params.slot;
    const name = req.params.name;
    const url = `https://${name}/checkpointz/v1/beacon/slots/${slot}`
    get(url, res, next)
});

// beacon chain is different
server.get("/beaconcha.in/api/v1/block/:slot", (req: restify.Request, res: restify.Response, next: restify.Next) => {
    const slot = req.params.slot;
    const url = `https://beaconcha.in/api/v1/block/${slot}`
    get(url, res, next)
});
server.get("/prater.beaconcha.in/api/v1/block/:slot", (req: restify.Request, res: restify.Response, next: restify.Next) => {
    const slot = req.params.slot;
    const url = `https://prater.beaconcha.in/api/v1/block/${slot}`
    get(url, res, next)
});
server.get("/beacon.gnosischain.com/api/v1/block/:slot", (req: restify.Request, res: restify.Response, next: restify.Next) => {
    const slot = req.params.slot;
    const url = `https://beacon.gnosischain.com/api/v1/block/${slot}`
    get(url, res, next)
});

const get = (url: string, res: restify.Response, next: restify.Next) => {
    axios.get(url,
        {
            headers: {
                // 'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json',
            },
        }).then(
            (response: any) => {
                // console.dir(response.data.data)
                res.send(response.status, response.data.data)
                next();
            }
        ).catch(
            (error: any) => {
                console.log("Error contacting ", url, error);
                res.send(500, "failed")
                next();
            }
        )
}

server.get('/rest/*', (req: restify.Request, res: restify.Response, next: restify.Next) => {
    const path = req.params["*"]
    const url = `${server_config.rest_url}/${path}`

    axios.request({
        method: req.method as Method,
        url: url,
        data: req.body,
        headers: {
            'Content-Type': 'application/json'
        },
    }).then((response: any) => {
        res.send(response.status, response.data)
        next();
    }).catch((error: any) => {
        console.log("Error contacting ", url, error);
        res.send(500, "failed")
        next();
    });
});

server.get('/keymanager/*', (req: restify.Request, res: restify.Response, next: restify.Next) => {
    const path = req.params["*"]
    const url = `${server_config.keymanager_url}/${path}`
    processKeyMangerRequest(url, req, res, next); 1
});


server.post('/keymanager/*', (req: restify.Request, res: restify.Response, next: restify.Next) => {
    const path = req.params["*"]
    const url = `${server_config.keymanager_url}/${path}`
    processKeyMangerRequest(url, req, res, next);
});

server.del('/keymanager/*', (req: restify.Request, res: restify.Response, next: restify.Next) => {
    const path = req.params["*"]
    const url = `${server_config.keymanager_url}/${path}`
    processKeyMangerRequest(url, req, res, next);
});

const processKeyMangerRequest = (url: string, req: restify.Request, res: restify.Response, next: restify.Next) => {
    const keymanagertoken = getKeyManagerToken();
    // console.log(req.body, url, keymanagertoken);
    axios.request({
        method: req.method as Method,
        url: url,
        data: req.body,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${keymanagertoken}`
        },
    }).then((response: any) => {
        const data = response.data
        res.send(response.status, data)
        next();
    }).catch((error: any) => {
        console.log("Error contacting ", url, error);
        res.send(500, "failed")
        next();
    });
}

const getKeyManagerToken = () => {
    try {
        return fs.readFileSync(server_config.keymanager_token_path, 'utf8').trim();
    } catch (err) {
        console.error(err);
    }
}

server.listen(9999, function () {
    console.log("%s listening at %s", server.name, server.url);
});
