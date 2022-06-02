import React from "react";
import NetworkBanner from "./NetworkBanner";
import Header from "./Header";
import Validators from "./Validators";
import Settings from "./SettingsForm";

import tekulogo from "../assets/teku.png";
import { SettingsType } from "./Types";
import { RestApi } from "./RestApi";
import { SupervisorCtl } from "./SupervisorCtl";
import { WampConnection } from "./WampConnection";

export const packageName = "teku.avado.dnp.dappnode.eth";

const Comp = () => {
    const [newSession, setNewSession] = React.useState<WampConnection>();
    const [supervisorCtl, setSupervisorCtl] = React.useState<SupervisorCtl>();

    const [settings, setSettings] = React.useState<SettingsType>();

    const [restApi, setRestApi] = React.useState<RestApi>();
    const [keyManagerAPI, setKeyManagerAPI] = React.useState<RestApi>();

    const restApiUrl = "http://teku.my.ava.do:5051";
    const keyManagerAPIUrl = "https://teku.my.ava.do:5052"

    React.useEffect(() => {
        setNewSession(new WampConnection(packageName));
    }, []);

    React.useEffect(() => {
        newSession?.getFileContent("/data/settings.json")
            .then(
                (settings) => {
                    if (settings)
                        setSettings(JSON.parse(settings));
                }
            )
    }, [newSession]);

    React.useEffect(() => {
        if (!newSession || !settings)
            return;

        const dataPath = `/data/data-${settings?.network}`

        setRestApi(new RestApi(restApiUrl))

        newSession.getFileContent(`${dataPath}/validator/key-manager/validator-api-bearer`).then(
            (apiToken) => {
                if (apiToken) {
                    console.log("API token:", apiToken)
                    setKeyManagerAPI(new RestApi(keyManagerAPIUrl, apiToken))
                }
            }
        )
    }, [newSession, settings]) // eslint-disable-line

    const toggleTeku = (enable: boolean) => { // eslint-disable-line
        const method = enable ? 'supervisor.startProcess' : 'supervisor.stopProcess'
        supervisorCtl?.callMethod(method, ["teku"]);
    }

    React.useEffect(() => {
        const supervisorCtl = new SupervisorCtl('teku.my.ava.do', 5556, '/RPC2')
        setSupervisorCtl(supervisorCtl)
        supervisorCtl.callMethod("supervisor.getState", [])
    }, [])

    const writeSettingsToContainer = (settings: any) => {
        const fileName = "settings.json"
        const pathInContainer = "/data/"

        newSession?.writeFileToContainer(fileName, pathInContainer, JSON.stringify(settings))
    }

    return (
        <div className="dashboard has-text-white">
            <NetworkBanner network={settings?.network ?? "mainnet"} />

            {!newSession?.getSession() && (
                <section className="hero is-danger">
                    <div className="hero-body is-small">
                        <p className="has-text-centered">Avado Connection problem. Check your browser's console log for more details.</p>
                    </div>
                </section>
            )}

            <section className="has-text-white">
                <div className="columns is-mobile">
                    <div className="column">
                        <Header restApi={restApi} logo={tekulogo} title="Avado Teku" tagline="Teku beacon chain and validator" />

                        {restApi && keyManagerAPI && settings && (<Validators
                            settings={settings}
                            restAPI={restApi}
                            keyManagerAPI={keyManagerAPI}
                        />)}

                        {supervisorCtl && (<Settings settings={settings} setSettings={setSettings} writeSettingsToContainer={writeSettingsToContainer} supervisorCtl={supervisorCtl} />)}

                        <h2 className="title is-2 has-text-white">Debug</h2>
                        <div className="content">
                            <ul>
                                <li>
                                    <a href={`${restApiUrl}/swagger-ui`} target="_blank" rel="noopener noreferrer">Swagger RPC UI</a>

                                </li>
                                <li>
                                    <a href={`http://my.ava.do/#/Packages/${packageName}/detail`} target="_blank" rel="noopener noreferrer">Avado pacakge management page</a>

                                </li>
                            </ul>
                            <div className="field">
                                <button className="button" onClick={() => toggleTeku(true)}>Start Teku</button>
                                <button className="button" onClick={() => toggleTeku(false)}>Stop Teku</button>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    )
}

export default Comp;
