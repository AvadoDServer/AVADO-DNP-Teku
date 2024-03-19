import * as restify from "restify";
import corsMiddleware from "restify-cors-middleware2"
import axios, { Method } from "axios";
import * as fs from 'fs';
import { SupervisorCtl } from "./SupervisorCtl";
import { server_config } from "./server_config";
import defaultsettings from "./settings/defaultsettings.json";
import AdmZip from "adm-zip";
import { DappManagerHelper } from "./DappManagerHelper";
// import {open,close} from "./wampsession"
import autobahn from "autobahn";
console.log("Monitor starting...");

const server = restify.createServer({
    name: "MONITOR",
    version: "1.0.0"
});

const cors = corsMiddleware({
    preflightMaxAge: 5, //Optional
    origins: [
        /^http:\/\/localhost(:[\d]+)?$/,
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

// what mode are we in : zerosync or local
server.get("/mode", (req: restify.Request, res: restify.Response, next: restify.Next) => {
    res.send(200, process.env.MODE);
    next()
});

// overview of node status
server.get("/nodestatus", async (req: restify.Request, res: restify.Response, next: restify.Next) => {

    const clients = (await getInstalledClients())
    console.log(clients);
    res.send(200, "ok");
    return next()

});

server.get("/settings", (req: restify.Request, res: restify.Response, next: restify.Next) => {
    try {
        const settings = JSON.parse(fs.readFileSync(settings_file_path, 'utf8'))
        res.send(200, settings ? JSON.stringify(settings) : defaultsettings);
        next()
    } catch (err) {
        res.send(200, defaultsettings);
        next();
    }
});

server.post("/settings", (req: restify.Request, res: restify.Response, next: restify.Next) => {
    const settings = JSON.stringify(req.body, null, 4);
    fs.writeFileSync(settings_file_path, settings, 'utf8');
    restart().then((result) => {
        res.send(200, `Saved settings and restarted`);
        return next();
    })
});

server.get("/defaultsettings", (req: restify.Request, res: restify.Response, next: restify.Next) => {
    try {
        res.send(200, defaultsettings);
        next()
    } catch (err) {
        res.send(500, "failed")
        next();
    }
});

const supervisorCtl = new SupervisorCtl(`localhost`, 5555, '/RPC2')

const restart = async () => {
    await Promise.all([
        supervisorCtl.callMethod('supervisor.stopProcess', [server_config.name, true]),
    ])
    return Promise.all([
        supervisorCtl.callMethod('supervisor.startProcess', [server_config.name, true]),
    ])
}

server.post("/service/restart", (req: restify.Request, res: restify.Response, next: restify.Next) => {
    restart().then((result) => {
        res.send(200, "restarted");
        return next()
    }).catch((error) => {
        res.send(500, "failed")
        return next();
    })
});

server.post("/service/stop", (req: restify.Request, res: restify.Response, next: restify.Next) => {
    const method = 'supervisor.stopProcess'
    Promise.all([
        supervisorCtl.callMethod(method, [server_config.name]),
    ]).then(result => {
        res.send(200, "stopped");
        next()
    }).catch(err => {
        res.send(200, "failed")
        next();
    })
});

server.post("/service/start", (req: restify.Request, res: restify.Response, next: restify.Next) => {
    const method = 'supervisor.startProcess'
    Promise.all([
        supervisorCtl.callMethod(method, [server_config.name]),
    ]).then(result => {
        res.send(200, "started");
        next()
    }).catch(err => {
        res.send(200, "failed")
        next();
    })
});

server.get("/service/status", (req: restify.Request, res: restify.Response, next: restify.Next) => {
    const method = 'supervisor.getAllProcessInfo'
    supervisorCtl.callMethod(method, [])
        .then((value: any) => {
            res.send(200, value);
            next()
        }).catch((_error: any) => {
            res.send(500, "failed")
            next();
        });
});

////////////////////////
// Checkpoint API    ///
////////////////////////

// checkpoints APIs
server.get("/:name/checkpointz/v1/beacon/slots/:slot", (req: restify.Request, res: restify.Response, next: restify.Next) => {
    const slot = req.params.slot;
    const name = req.params.name;
    const url = `https://${name}/checkpointz/v1/beacon/slots/${slot}`
    get(url, res, next)
});

////////////////////////
// beaconcha.in API   //
////////////////////////
server.get("/beaconcha.in/*", (req: restify.Request, res: restify.Response, next: restify.Next) => {
    const path = req.params["*"]
    const url = `https://beaconcha.in/${path}`
    get(url, res, next)
});
server.get("/prater.beaconcha.in/*", (req: restify.Request, res: restify.Response, next: restify.Next) => {
    const path = req.params["*"]
    const url = `https://prater.beaconcha.in/${path}`
    get(url, res, next)
});
server.get("/beacon.gnosischain.com/*", (req: restify.Request, res: restify.Response, next: restify.Next) => {
    const path = req.params["*"]
    const url = `https://beacon.gnosischain.com/${path}`
    get(url, res, next)
});

const get = (url: string, res: restify.Response, next: restify.Next) => {
    axios.get(url, {
        headers: { 'Content-Type': 'application/json' },
    }).then(
        (response: any) => {
            // console.dir(response.data.data)
            res.send(response.status, response.data.data)
            next();
        }
    ).catch(function (error) {
        console.log("Error contacting ", url, error);
        console.log("config", JSON.stringify(error.config));
        if (error.response) {
            console.log('Error', error.response.data);
            res.send(error.response.status, error.response.data)
            next();
        } else if (error.request) {
            console.log(error.request);
            res.send(500, error.request)
            next();
        } else {
            console.log('Error', error.message);
            res.send(500, error.message)
            next();
        }
    })
}

///////////////////////////////////
// Local Beacon chain rest API   //
///////////////////////////////////

server.get('/rest/*', (req: restify.Request, res: restify.Response, next: restify.Next) => {
    processRestRequest(server_config.rest_url_local, req, res, next);
});

server.post('/rest/*', (req: restify.Request, res: restify.Response, next: restify.Next) => {
    processRestRequest(server_config.rest_url_local, req, res, next);
});

//////////////////////////////////////
// zerosync Beacon chain rest API   //
//////////////////////////////////////

server.get('/zerosync/*', (req: restify.Request, res: restify.Response, next: restify.Next) => {
    processRestRequest(server_config.rest_url_zerosync, req, res, next);
});

server.post('/zerosync/*', (req: restify.Request, res: restify.Response, next: restify.Next) => {
    processRestRequest(server_config.rest_url_zerosync, req, res, next);
});
const processRestRequest = (rest_url: string, req: restify.Request, res: restify.Response, next: restify.Next) => {
    const path = req.params["*"]
    const url = `${rest_url}/${path}`
    console.log(`fething ${url}`);
    const headers = {
        'Content-Type': 'application/json'
    }
    axiosRequest(
        url,
        headers,
        req,
        res,
        next
    )
}

/////////////////////////////
// Key manager API         //
/////////////////////////////

server.get('/keymanager/*', (req: restify.Request, res: restify.Response, next: restify.Next) => {
    processKeyMangerRequest(req, res, next);
});


server.post('/keymanager/*', (req: restify.Request, res: restify.Response, next: restify.Next) => {
    processKeyMangerRequest(req, res, next);
});

server.del('/keymanager/*', (req: restify.Request, res: restify.Response, next: restify.Next) => {
    processKeyMangerRequest(req, res, next);
});

const processKeyMangerRequest = (req: restify.Request, res: restify.Response, next: restify.Next) => {
    const path = req.params["*"]
    const url = `${server_config.keymanager_url}/${path}`
    const keymanagertoken = getKeyManagerToken();
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${keymanagertoken}`
    }

    // console.log(req.body, url, keymanagertoken);
    axiosRequest(
        url,
        headers,
        req,
        res,
        next
    )
}

const axiosRequest = (url: string, headers: object, req: restify.Request, res: restify.Response, next: restify.Next) => {
    axios.request({
        method: req.method as Method,
        url: url,
        data: req.body,
        headers: headers,
    }).then((response: any) => {
        res.send(response.status, response.data)
        next();
    }).catch(function (error) {
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.log('Error', error.response.data);
            // console.log(error.response.status);
            // console.log(error.response.headers);
            res.send(error.response.status, error.response.data)
            next();
        } else if (error.request) {
            // The request was made but no response was received
            // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
            // http.ClientRequest in node.js
            // console.log(error.request);
            console.log(`fetching ${url} returned en error without a response`)
            res.send(500, error.message)
            next();
        } else {
            // Something happened in setting up the request that triggered an Error
            console.log('Error', error.message);
            res.send(500, error.message)
            next();
        }
        console.log("config", JSON.stringify(error.config));
    });

}

const getKeyManagerToken = () => {
    try {
        return fs.readFileSync(server_config.keymanager_token_path, 'utf8').trim();
    } catch (err) {
        console.error(err);
    }
}

// backup/restore


//backup
const backupFileName = `teku-backup-${server_config.network}-${(new Date()).toDateString()}.zip`;
server.get("/backup", (req, res, next) => {
    res.setHeader("Content-Disposition", `attachment; filename="${backupFileName}"`);
    res.setHeader("Content-Type", "application/zip");

    const zip = new AdmZip();
    zip.addLocalFile("/data/config.yml",);
    zip.addLocalFile("/data/settings.json",);    
    zip.addLocalFolder("/data/data-mainnet/validator","data-mainnet/validator");
    zip.toBuffer(
        (buffer: Buffer) => {
            // if (err) {
            //     reject(err);
            // } else {
            res.setHeader("Content-Length", buffer.length);
            res.end(buffer, "binary");
            next()
            // }
        }
    )
});

// //restore
// server.post('/restore', (req, res, next) => {
//     console.log("upload backup zip file");
//     if (req.files?.file) {
//         const file = req.files.file;
//         // req.info = file.name;
//         const zipfilePath = "/tmp/" + file.name;
//         fs.renameSync(file.path, zipfilePath); //, (err) => { if (err) console.log('ERROR: ' + err) });
//         console.log("received backup file " + file.name);
//         try {
//             validateZipFile(zipfilePath);

//             // delete existing data folder (if it exists)
//             fs.rmSync("/rocketpool/data", { recursive: true, force: true /* ignore if not exists */ });

//             // unzip
//             const zip = new AdmZip(zipfilePath);
//             zip.extractAllTo("/rocketpool/", /*overwrite*/ true);

//             res.send({
//                 code: 200,
//                 message: "Successfully uploaded the Rocket Pool backup. Click restart to complete the restore.",
//             });
//             return next();
//         } catch (err) {
//             if (err instanceof Error) {
//                 console.dir(err);
//                 console.log(err);
//                 res.send({
//                     code: 400,
//                     message: err.message,
//                 });
//             } else {
//                 res.send({
//                     code: 400,
//                     message: "unknown error",
//                 });

//             }
//             return next();
//         }
//     }

//     function validateZipFile(zipfilePath: string) {
//         console.log("Validating " + zipfilePath);
//         const zip = new AdmZip(zipfilePath);
//         const zipEntries = zip.getEntries();

//         checkFileExistsInZipFile(zipEntries, "data/settings.json")
//         checkFileExistsInZipFile(zipEntries, "data/config.yml")
//         checkFileExistsInZipFile(zipEntries, "data/data-mainnet")
//         checkFileExistsInZipFile(zipEntries, "data/data-mainnet/validators")
//     }

//     function checkFileExistsInZipFile(zipEntries: AdmZip.IZipEntry[], expectedPath: string) {
//         const containsFile = zipEntries.some((entry) => entry.entryName == expectedPath);
//         if (!containsFile)
//             throw { message: `Invalid backup file. The zip file must contain "${expectedPath}"` }
//     }
// });


let wampSession: any = null;
{
    const url = "ws://wamp.my.ava.do:8080/ws";
    const realm = "dappnode_admin";

    const connection = new autobahn.Connection({ url, realm });
    connection.onopen = (session: any) => {
        console.log("CONNECTED to \nurl: " + url + " \nrealm: " + realm);
        wampSession = session;
    };
    connection.open();
}

const getInstalledClients = async () => {
    const dappManagerHelper = new DappManagerHelper(server_config.name, wampSession);
    const packages = await dappManagerHelper.getPackages();


    console.log(`packages`,packages)


    // const installed_clients = supported_beacon_chain_clients
    //     .filter(client => (packages.includes(getAvadoPackageName(client, "beaconchain"))
    //         && packages.includes(getAvadoPackageName(client, "validator")))
    //     )
    //     .map(client => ({
    //         name: client,
    //         url: `http://${client_url(client)}`,
    //         validatorAPI: `http://${client_url(client)}:9999/keymanager`
    //     }))
    // return installed_clients;
}


server.listen(9999, function () {
    console.log("%s listening at %s", server.name, server.url);
});
