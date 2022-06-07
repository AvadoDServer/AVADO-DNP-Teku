import React from "react";
import NetworkBanner from "./NetworkBanner";
import Header from "./Header";
import Validators from "./Validators";
import Settings from "./SettingsForm";

import tekulogo from "../assets/teku.png";
import { SettingsType } from "./Types";
import { RestApi } from "./RestApi";
import { SupervisorCtl } from "./SupervisorCtl";
import { useWampSession } from "./useWampSession"
import { DappManagerHelper } from "./DappManagerHelper";

export const packageName = "nimbus.avado.dnp.dappnode.eth";

const Comp = () => {
    const wampSession = useWampSession();
    const dappManagerHelper = React.useMemo(() => new DappManagerHelper(packageName, wampSession), [wampSession]);

    const [supervisorCtl, setSupervisorCtl] = React.useState<SupervisorCtl>();

    const [settings, setSettings] = React.useState<SettingsType>();

    const [restApi, setRestApi] = React.useState<RestApi | null>();
    const [keyManagerAPI, setKeyManagerAPI] = React.useState<RestApi>();

    const restApiUrl = "http://nimbus.my.ava.do:5677";
    const keyManagerAPIUrl = "http://nimbus.my.ava.do:5677"

    React.useEffect(() => {
        if (wampSession && dappManagerHelper) {
            dappManagerHelper.getFileContentFromContainer("/data/settings.json")
                .then(
                    (settings) => {
                        if (settings)
                            setSettings(JSON.parse(settings));
                    }
                )
        }
    }, [wampSession, dappManagerHelper]);

    React.useEffect(() => {
        if (!wampSession || !settings || !dappManagerHelper) {
            setRestApi(null);
            return;
        }
        setRestApi(new RestApi(restApiUrl))

        dappManagerHelper.getFileContentFromContainer(`/data/KEY-API-TOKEN`).then(
            (apiToken) => {
                if (apiToken && apiToken !== keyManagerAPI?.apiKey) {
                    console.log("API token:", apiToken)
                    setKeyManagerAPI(new RestApi(keyManagerAPIUrl, apiToken))
                }
            }
        )
    }, [wampSession, dappManagerHelper, settings]) // eslint-disable-line

    const toggleTeku = (enable: boolean) => { // eslint-disable-line
        const method = enable ? 'supervisor.startProcess' : 'supervisor.stopProcess'
        supervisorCtl?.callMethod(method, ["nimbus"]);
    }

    React.useEffect(() => {
        const supervisorCtl = new SupervisorCtl('nimbus.my.ava.do', 5556, '/RPC2')
        setSupervisorCtl(supervisorCtl)
        supervisorCtl.callMethod("supervisor.getState", [])
    }, [])

    const writeSettingsToContainer = (settings: any) => {
        const fileName = "settings.json"
        const pathInContainer = "/data/"

        dappManagerHelper?.writeFileToContainer(fileName, pathInContainer, JSON.stringify(settings))
    }

    return (
        <div className="dashboard has-text-white">
            <NetworkBanner network={settings?.network ?? "mainnet"} />

            {!dappManagerHelper && (
                <section className="hero is-danger">
                    <div className="hero-body is-small">
                        <p className="has-text-centered">Avado Connection problem. Check your browser's console log for more details.</p>
                    </div>
                </section>
            )}

            <section className="has-text-white">
                <div className="columns is-mobile">
                    <div className="column">
                        <Header restApi={restApi} logo={tekulogo} title="Avado Nimbus" tagline="Nimbus beacon chain and validator" />

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
                                    <a href={`http://my.ava.do/#/Packages/${packageName}/detail`} target="_blank" rel="noopener noreferrer">Avado package management page</a>

                                </li>
                            </ul>
                            <div className="field">
                                <button className="button" onClick={() => toggleTeku(true)}>Start Nimbus</button>
                                <button className="button" onClick={() => toggleTeku(false)}>Stop Nimbus</button>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    )
}

export default Comp;
