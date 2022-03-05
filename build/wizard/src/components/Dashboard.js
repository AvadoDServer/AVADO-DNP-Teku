import React from "react";
import autobahn from "autobahn-browser";
import NetworkBanner from "./NetworkBanner";
import Header from "./Header";
import AddValidator from "./AddValidator";
import axios from "axios";
import Validators from "./Validators";
import Settings from "./Settings";


export const packageName = "teku.avado.dnp.dappnode.eth";

const Comp = () => {
    const [wampSession, setWampSession] = React.useState();
    const [network, setNetwork] = React.useState("");
    const [apiToken, setApiToken] = React.useState("");
    const [validators, setValidators] = React.useState("");
    const [configuration, setConfiguration] = React.useState("");


    React.useEffect(() => {
        const url = "ws://wamp.my.ava.do:8080/ws";
        const realm = "dappnode_admin";
        const connection = new autobahn.Connection({
            url,
            realm
        });
        connection.onopen = session => {
            console.debug("CONNECTED to \nurl: " + url + " \nrealm: " + realm);
            setWampSession(session);
        };
        // connection closed, lost or unable to connect
        connection.onclose = (reason, details) => {
            this.setState({ connectedToDAppNode: false });
            console.error("CONNECTION_CLOSE", { reason, details });
        };
        connection.open();
    }, []);

    React.useEffect(() => {
        if (wampSession)
            getNetwork();
    }, [wampSession]) // eslint-disable-line

    function dataUriToBlob(dataURI) {
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

    const getFileContent = (wampSession, pathInContainer) => {
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
        getFileContent(wampSession, "/data/data-prater/validator/key-manager/validator-api-bearer").then(
            (apiToken) => setApiToken(apiToken)
        )
        getFileContent(wampSession, "/data/config.yml").then(
            (config) => setConfiguration(config)
        )
    }, [wampSession]) // eslint-disable-line

    React.useEffect(() => {
        if (apiToken)
            updateValidators();
    }, [apiToken])



    const updateValidators = async () => {
        if (apiToken) {
            return await axios.get("https://teku.my.ava.do:5052/eth/v1/keystores", {
                headers: {
                    Accept: "application/json",
                    Authorization: `Bearer ${apiToken}`
                }
            }).then((res) => {
                if (res.status === 200) {
                    setValidators(res.data.data.map(d => d.validating_pubkey))
                }
            });

        }
    }

    const getNetwork = async () => {
        const packagesRaw = await wampSession.call("listPackages.dappmanager.dnp.dappnode.eth", [],);
        const packages = JSON.parse(packagesRaw);
        if (packages.success) {
            setNetwork(packages.result.find(r => r.name === packageName).envs.NETWORK)
        }
    }

    return (
        <div className="dashboard has-text-white">
            <NetworkBanner network={network} />

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
                        <Header />

                        <Validators pubKeys={validators} network={network} apiToken={apiToken} updateValidators={updateValidators} />

                        <AddValidator apiToken={apiToken} updateValidators={updateValidators} />

                        <Settings getFileContent={getFileContent} wampSession={wampSession} />

                        <h2 className="title is-2 has-text-white">Debug</h2>
                        <div className="content">
                            <ul>
                                <li>
                                    <a href="http://teku.my.ava.do:5051/swagger-ui" target="_blank" rel="noopener noreferrer">Swagger RPC UI</a>

                                </li>
                                <li>
                                    <a href="http://my.ava.do/#/Packages/teku.avado.dnp.dappnode.eth/detail" target="_blank" rel="noopener noreferrer">Avado pacakge management page</a>

                                </li>
                            </ul>
                        </div>

                        <h2 className="title is-2 has-text-white">configuration</h2>
                        <div className="container">
                            <pre className="transcript">
                                {configuration}
                            </pre>
                        </div>
                    </div>
                </div>
            </section>

        </div>

    )
}


export default Comp;
