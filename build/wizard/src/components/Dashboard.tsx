import React from "react";
import { BrowserRouter, Route, Switch } from "react-router-dom";

import NetworkBanner from "./NetworkBanner";
import Header from "./Header";
import Settings from "./SettingsForm";
import MainPage from "./MainPage";
import AdminPage from "./AdminPage";
import NavigationBar from "./NavigationBar";

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

    React.useEffect(() => {
        if (wampSession && dappManagerHelper) {
            dappManagerHelper.getFileContentFromContainer(settingsPathInContainer + settingsFileName)
                .then(
                    (rawSettings) => {
                        if (rawSettings) {
                            const settings = JSON.parse(rawSettings)
                            setSettings(settings);
                            if (settings) {
                                // try setting new settings after an update
                                if (!settings.ee_endpoint) {
                                    settings.ee_endpoint = settings.eth1_endpoints[0].replace(":8545", ":8551") // intialize with first eth1-endpoint if not set yet
                                    applySettingsChanges(settings)
                                }
                                if (!settings.validators_proposer_default_fee_recipient) {
                                    settings.validators_proposer_default_fee_recipient = "" // force check on intial load after update
                                }
                                setSettings(settings)
                                console.log("Loaded settings: ", settings);
                            } else {
                                setSettings(defaultSettings)
                            }
                        } else {
                            setSettings(defaultSettings)
                        }
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

        dappManagerHelper.getFileContentFromContainer(`/data/data-${settings.network}/validator/key-manager/validator-api-bearer`).then(
            (apiToken) => {
                if (apiToken && apiToken !== keyManagerAPI?.apiKey) {
                    console.log("API token:", apiToken)
                    setKeyManagerAPI(new RestApi(keyManagerAPIUrl, apiToken))
                }
            }
        )
    }, [wampSession, dappManagerHelper, settings]) // eslint-disable-line

    const applySettingsChanges = (newSettings: any) => {
        setSettings(newSettings)
        dappManagerHelper?.writeFileToContainer(settingsFileName, settingsPathInContainer, JSON.stringify(newSettings))
        //wait a bit to make sure the settings file is written      
        setTimeout(function () {
            supervisorCtl?.callMethod('supervisor.restart', [])
        }, 5000);

    }

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
                        <Header restApi={restApi} logo={tekulogo} title="Avado Teku" tagline="Teku beacon chain and validator" />
                        <BrowserRouter>
                            <NavigationBar />
                            <Switch>
                                <Route exact path="/">
                                    <MainPage settings={settings} restApi={restApi} keyManagerAPI={keyManagerAPI} />
                                </Route>
                                <Route exact path="/settings">
                                    <Settings settings={settings} applySettingsChanges={applySettingsChanges} />
                                </Route>
                                <Route exact path="/admin">
                                    <AdminPage supervisorCtl={supervisorCtl} restApi={restApi} dappManagerHelper={dappManagerHelper} />
                                </Route>
                            </Switch>
                        </BrowserRouter>
                    </div>
                </div>
            </section>
        </div>
    )
}

export default Comp;
