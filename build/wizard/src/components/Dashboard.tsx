import React from "react";
import NetworkBanner from "./NetworkBanner";
import Header from "./Header";
import Validators from "./Validators";
import Settings from "./Settings";
import xmlrpc from "xmlrpc";

import tekulogo from "../assets/teku.png";
import { SettingsType } from "./Types";

const autobahn = require('autobahn-browser')

export const packageName = "teku.avado.dnp.dappnode.eth";

const Comp = () => {
    const [wampSession, setWampSession] = React.useState();
    const [apiToken, setApiToken] = React.useState<string>("");
    const [configuration, setConfiguration] = React.useState<string|undefined>();  // eslint-disable-line
    const [settings, setSettings] = React.useState<SettingsType>();

    React.useEffect(() => {
        const url = "ws://wamp.my.ava.do:8080/ws";
        const realm = "dappnode_admin";
        const connection = new autobahn.Connection({url,realm});
        connection.onopen = (session:any) => {
            console.debug("CONNECTED to \nurl: " + url + " \nrealm: " + realm);
            setWampSession(session);
        };
        // connection closed, lost or unable to connect
        connection.onclose = (reason:any, details:any) => {            
            console.error("CONNECTION_CLOSE", { reason, details });
        };
        connection.open();
    }, []);

    function dataUriToBlob(dataURI:string) {
        if (!dataURI || typeof dataURI !== "string")
            throw Error("dataUri must be a string");

        // Credit: https://stackoverflow.com/questions/12168909/blob-from-dataurl
        // convert base64 to raw binary data held in a string
        // doesn't handle URLEncoded DataURIs - see SO answer #6850276 for code that does this
        const byteString = atob(dataURI.split(",")[1]);
        // separate out the mime component
        // dataURI = data:application/zip;base64,UEsDBBQAAAg...
        const mimeString = dataURI
            .split(",")[0]
            .split(":")[1]
            .split(";")[0];
        // write the bytes of the string to an ArrayBuffer
        const ab = new ArrayBuffer(byteString.length);
        // create a view into the buffer
        const ia = new Uint8Array(ab);
        // set the bytes of the buffer to the correct values
        for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
        }
        // write the ArrayBuffer to a blob, and you're done
        const blob = new Blob([ab], { type: mimeString });
        return blob;
    }

    const getFileContent = (wampSession:any, pathInContainer:string) => {
        const fetchData = async () => {
            const res = JSON.parse(await wampSession.call("copyFileFrom.dappmanager.dnp.dappnode.eth", [],
                {
                    id: packageName,
                    fromPath: pathInContainer
                }
            ));
            if (res.success !== true) return;
            const dataUri = res.result;
            if (!dataUri) return;
            const data = await dataUriToBlob(dataUri).text();

            return data
        }
        return fetchData();
    }

    React.useEffect(() => {
        if (!wampSession)
            return;
        const dataPath=`/data/data-${settings?.network}`

        getFileContent(wampSession, `${dataPath}/validator/key-manager/validator-api-bearer`).then(
            (apiToken) => setApiToken(apiToken ?? "")
        )
    }, [wampSession, settings]) // eslint-disable-line


    React.useEffect(() => {
        if (!wampSession)
            return;
        getFileContent(wampSession, "/data/config.yml").then(
            (config) => setConfiguration(config)
        )
    }, [settings, wampSession]) // eslint-disable-line

    // methods: http://supervisord.org/api.html
    // ['supervisor.addProcessGroup', 'supervisor.clearAllProcessLogs', 'supervisor.clearLog', 'supervisor.clearProcessLog',
    //     'supervisor.clearProcessLogs', 'supervisor.getAPIVersion', 'supervisor.getAllConfigInfo', 'supervisor.getAllProcessInfo',
    //     'supervisor.getIdentification', 'supervisor.getPID', 'supervisor.getProcessInfo', 'supervisor.getState', 'supervisor.getSupervisorVersion',
    //     'supervisor.getVersion', 'supervisor.readLog', 'supervisor.readMainLog', 'supervisor.readProcessLog', 'supervisor.readProcessStderrLog',
    //     'supervisor.readProcessStdoutLog', 'supervisor.reloadConfig', 'supervisor.removeProcessGroup', 'supervisor.restart', 'supervisor.sendProcessStdin',
    //     'supervisor.sendRemoteCommEvent', 'supervisor.shutdown', 'supervisor.signalAllProcesses', 'supervisor.signalProcess', 'supervisor.signalProcessGroup',
    //     'supervisor.startAllProcesses', 'supervisor.startProcess', 'supervisor.startProcessGroup', 'supervisor.stopAllProcesses', 'supervisor.stopProcess',
    //     'supervisor.stopProcessGroup', 'supervisor.tailProcessLog', 'supervisor.tailProcessStderrLog', 'supervisor.tailProcessStdoutLog',
    //     'system.listMethods', 'system.methodHelp', 'system.methodSignature', 'system.multicall']
    const supervisorCtl = (method:string, params:any[]) => {
        if (wampSession) {
            const client = xmlrpc.createClient({ host: 'teku.my.ava.do', port: 5556, path: '/RPC2' })
            client.methodCall(method, params, (error:any, value) => {
                if (error) {
                    console.log('supervisorCtl Teku error:', error);
                    console.log('req headers:', error.req && error.req._header);
                    console.log('res code:', error.res && error.res.statusCode);
                    console.log('res body:', error.body);
                } else {
                    console.log('supervisorCtl Teku: ', value);
                    return value;
                }
            })
        }
    }

    const toggleTeku = (enable:boolean) => { // eslint-disable-line
        const method = enable ? 'supervisor.startProcess' : 'supervisor.stopProcess'
        supervisorCtl(method, ["teku"]);
    }

    React.useEffect(() => {
        supervisorCtl("supervisor.getState", [])
    }, [wampSession]) // eslint-disable-line

    return (
        <div className="dashboard has-text-white">
            <NetworkBanner network={settings?.network??"mainnet"} />

            {!wampSession && (
                <section className="hero is-danger">
                    <div className="hero-body is-small">
                        <p className="has-text-centered">Avado Connection problem. Check your browser's console log for more details.</p>
                    </div>
                </section>
            )}

            <section className="has-text-white">
                <div className="columns is-mobile">
                    <div className="column">
                        <Header beacon_node_api_url="http://teku.my.ava.do:5051" logo={tekulogo} title="Avado Teku" tagline="Teku beacon chain and validator"/>

                        <Validators settings={settings} apiToken={apiToken} />

                        <Settings getFileContent={getFileContent} wampSession={wampSession} settings={settings} setSettings={setSettings} supervisorCtl={supervisorCtl} />

                        {/* <h2 className="title is-2 has-text-white">Debug</h2>
                        <div className="content">
                            <ul>
                                <li>
                                    <a href="http://teku.my.ava.do:5051/swagger-ui" target="_blank" rel="noopener noreferrer">Swagger RPC UI</a>

                                </li>
                                <li>
                                    <a href="http://my.ava.do/#/Packages/teku.avado.dnp.dappnode.eth/detail" target="_blank" rel="noopener noreferrer">Avado pacakge management page</a>

                                </li>
                            </ul>
                        </div> */}

                        {/* <h2 className="title is-2 has-text-white">configuration</h2>
                        <div className="container">
                            <pre className="transcript">
                                {configuration}
                            </pre>
                        </div> */}
                    </div>
                </div>
            </section>

        </div>

    )
}


export default Comp;
