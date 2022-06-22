import React, { useCallback } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";

import NetworkBanner from "./NetworkBanner";
import Header from "./Header";
import Settings from "./SettingsForm";
import MainPage from "./MainPage";
import AdminPage from "./AdminPage";
import NavigationBar from "./NavigationBar";
import Welcome from "./Welcome";

import tekulogo from "../assets/teku.png";
import { defaultSettings, SettingsType } from "./Types";
import { RestApi } from "./RestApi";
import { SupervisorCtl } from "./SupervisorCtl";
import { useWampSession } from "./useWampSession"
import { DappManagerHelper } from "./DappManagerHelper";

export const packageName = "teku.avado.dnp.dappnode.eth";

const Comp = () => {
    const wampSession = useWampSession();
    const dappManagerHelper = React.useMemo(() => new DappManagerHelper(packageName, wampSession), [wampSession]);

    const [supervisorCtl, setSupervisorCtl] = React.useState<SupervisorCtl>();

    const [settings, setSettings] = React.useState<SettingsType>();

    const [restApi, setRestApi] = React.useState<RestApi | null>();
    const [keyManagerAPI, setKeyManagerAPI] = React.useState<RestApi>();

    
    const restApiUrl = "http://teku.my.ava.do:5051";
    const keyManagerAPIUrl = "https://teku.my.ava.do:5052"
    
    const settingsPathInContainer = "/data/"
    const settingsFileName = "settings.json"
    
    const navigate = useNavigate();

    const applySettingsChanges = useCallback((newSettings: any) => {
        setSettings(newSettings)
        dappManagerHelper?.writeFileToContainer(settingsFileName, settingsPathInContainer, JSON.stringify(newSettings))
        //wait a bit to make sure the settings file is written
        setTimeout(function () {
            supervisorCtl?.callMethod('supervisor.restart', [])
        }, 5000);
    }, [dappManagerHelper, supervisorCtl])

    React.useEffect(() => {
        if (wampSession && dappManagerHelper && !settings) {
            dappManagerHelper.getFileContentFromContainer(settingsPathInContainer + settingsFileName)
                .then(
                    (rawSettings) => {
                        if (rawSettings) {
                            const parsedSettings = JSON.parse(rawSettings)
                            if (parsedSettings) {
                                // try setting new settings after an update
                                if (!parsedSettings.ee_endpoint) {
                                    parsedSettings.ee_endpoint = parsedSettings.eth1_endpoints[0].replace(":8545", ":8551") // intialize with first eth1-endpoint if not set yet
                                    applySettingsChanges(parsedSettings)
                                }
                                if (!parsedSettings.validators_proposer_default_fee_recipient) {
                                    parsedSettings.validators_proposer_default_fee_recipient = "" // force check on intial load after update
                                }
                                setSettings(parsedSettings)
                                console.log("Loaded settings: ", parsedSettings);
                            } else {
                                setSettings(defaultSettings)
                            }
                        } else {
                            navigate("/welcome");
                            setSettings(defaultSettings)
                        }
                    }
                )
        }
    }, [wampSession, dappManagerHelper, settings, applySettingsChanges, navigate]);

    React.useEffect(() => {
        if (!wampSession || !settings || !dappManagerHelper) {
            setRestApi(null);
            return;
        }
        if (!restApi)
            setRestApi(new RestApi(restApiUrl))

        dappManagerHelper.getFileContentFromContainer(`/data/data-${settings.network}/validator/key-manager/validator-api-bearer`).then(
            (apiToken) => {
                if (apiToken && apiToken !== keyManagerAPI?.apiKey) {
                    console.log("API token:", apiToken)
                    setKeyManagerAPI(new RestApi(keyManagerAPIUrl, apiToken))
                }
            }
        )
    }, [wampSession, dappManagerHelper, settings, keyManagerAPI, restApi])

    React.useEffect(() => {
        const supervisorCtl = new SupervisorCtl('teku.my.ava.do', 5556, '/RPC2')
        setSupervisorCtl(supervisorCtl)
        supervisorCtl.callMethod("supervisor.getState", [])
    }, [])


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
                        <Header restApi={restApi} logo={tekulogo} title="Avado Teku" tagline="Teku beacon chain and validator" wikilink="https://wiki.ava.do/en/tutorials/teku"/>

                        <NavigationBar />
                        <Routes>
                            <Route path="/" element={<MainPage settings={settings} restApi={restApi} keyManagerAPI={keyManagerAPI} />} />
                            <Route path="/welcome" element={<Welcome logo={tekulogo} title="Avado Teku" dappManagerHelper={dappManagerHelper} />} />
                            <Route path="/settings" element={<Settings settings={settings} applySettingsChanges={applySettingsChanges} />} />
                            <Route path="/admin" element={<AdminPage supervisorCtl={supervisorCtl} restApi={restApi} dappManagerHelper={dappManagerHelper} />} />
                        </Routes>

                    </div>
                </div>
            </section>
        </div>
    )
}

export default Comp;
