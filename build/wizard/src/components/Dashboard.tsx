import React, { useCallback } from "react";
import { Route, Routes, useNavigate, useSearchParams } from "react-router-dom";

import NetworkBanner from "./shared/NetworkBanner";
import Header from "./shared/Header";
import SettingsForm from "./SettingsForm";
import MainPage from "./MainPage";
import AdminPage from "./AdminPage";
import NavigationBar from "./shared/NavigationBar";
import Welcome from "./shared/Welcome";

import logo from "../assets/nimbus.png";
import defaultSettings from "./defaultsettings.json"
import { SettingsType } from "./shared/Types";
import { RestApi } from "./shared/RestApi";
import { SupervisorCtl } from "./shared/SupervisorCtl";
import { useWampSession } from "./shared/useWampSession"
import { DappManagerHelper } from "./shared/DappManagerHelper";
import FeeRecepientBanner from "./shared/FeeRecepientBanner";
import ExecutionEngineBanner from "./shared/ExecutionEngineBanner";
import CheckCheckPointSync from "./shared/CheckCheckPointSync";

import server_config from "../server_config.json";

export const packagePrefix = server_config.network === "mainnet" ? server_config.name : `${server_config.name}-${server_config.network}`;
export const packageName = `${packagePrefix}.avado.dnp.dappnode.eth`;
export const packageUrl = `${packagePrefix}.my.ava.do`;


const Comp = () => {
    const wampSession = useWampSession();
    const dappManagerHelper = React.useMemo(() => wampSession ? new DappManagerHelper(packageName, wampSession) : null, [wampSession]);

    const [supervisorCtl, setSupervisorCtl] = React.useState<SupervisorCtl>();

    const [settings, setSettings] = React.useState<SettingsType>();

    const [restApi, setRestApi] = React.useState<RestApi | null>();
    const [keyManagerAPI, setKeyManagerAPI] = React.useState<RestApi>();


    const settingsPathInContainer = "/data/"
    const settingsFileName = "settings.json"

    const restApiUrl = `http://${packageUrl}:9999/rest`;
    const keyManagerAPIUrl = `http://${packageUrl}:9999/rest`;

    const capitalizeFirstLetter = (name:string) => name.charAt(0).toUpperCase() + name.slice(1);

    const getTitle = () => {
        const clientName = capitalizeFirstLetter(server_config.name)
        const networkName = capitalizeFirstLetter(server_config.network)
        switch (server_config.network) {
            case "gnosis": return `Avado ${clientName} ${networkName}`
            case "prater": return `Avado ${clientName} ${networkName} Testnet`
            default: return `Avado ${clientName}`;
        }
    }

    const getWikilink = () => {
        switch (server_config.network) {
            case "gnosis": return "https://docs.ava.do/packages/gnosis/"
            default: return `https://docs.ava.do/packages/${server_config.name}/`;
        }
    }

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
                                if (!parsedSettings.validators_proposer_default_fee_recipient) {
                                    parsedSettings.validators_proposer_default_fee_recipient = "" // force check on intial load after update
                                }
                                if (!parsedSettings.execution_engine) {
                                    parsedSettings.execution_engine = "ethchain-geth.public.dappnode.eth"
                                }
                                setSettings(parsedSettings)
                                console.log("Loaded settings: ", parsedSettings);
                            } else {
                                setSettings(defaultSettings)
                            }
                        } else {
                            console.log("Missing settings file, writing default settings")
                            applySettingsChanges(defaultSettings)
                            // navigate("/welcome");
                        }
                    }
                )
        }
    }, [wampSession, dappManagerHelper, settings, applySettingsChanges, navigate]);

    const [packages, setPackages] = React.useState<string[]>();
    React.useEffect(() => {
        if (wampSession && dappManagerHelper) {
            dappManagerHelper.getPackages().then((packages) => {
                setPackages(packages)
            })
        }
    }, [wampSession, dappManagerHelper]);

    React.useEffect(() => {
        if (!wampSession || !settings || !dappManagerHelper) {
            setRestApi(null);
            return;
        }
        if (!restApi) {
            setRestApi(new RestApi(restApiUrl))
        }

        if (!keyManagerAPI) {
            setKeyManagerAPI(new RestApi(keyManagerAPIUrl))
        }
    }, [wampSession, dappManagerHelper, settings, keyManagerAPI, restApi])

    React.useEffect(() => {
        const supervisorCtl = new SupervisorCtl(`${packagePrefix}.my.ava.do`, 5556, '/RPC2')


        setSupervisorCtl(supervisorCtl)
        supervisorCtl.callMethod("supervisor.getState", [])
    }, [])

    const [searchParams] = useSearchParams()
    const isAdminMode = searchParams.get("admin") !== null

    return (

        <div className="dashboard has-text-black maincontainer">
            <NetworkBanner network={server_config.network} />

            {!dappManagerHelper && (
                <section className="hero is-danger">
                    <div className="hero-body is-small">
                        <p className="has-text-centered">Avado Connection problem. Check your browser's console log for more details.</p>
                    </div>
                </section>
            )}

            <section className="has-text-black">
                <div className="columns is-mobile">
                    <div className="column">
                        <Header restApi={restApi} logo={logo} title={getTitle()} tagline={`${capitalizeFirstLetter(server_config.name)} beacon chain and validator`} wikilink={getWikilink()} />

                        <NavigationBar />

                        <FeeRecepientBanner validators_proposer_default_fee_recipient={settings?.validators_proposer_default_fee_recipient} navigate={navigate} />
                        <ExecutionEngineBanner execution_engine={settings?.execution_engine} wikilink={getWikilink()} installedPackages={packages} client={capitalizeFirstLetter(server_config.name)} />

                        <Routes>
                            {restApi && (<Route path="/" element={<MainPage settings={settings} restApi={restApi} keyManagerAPI={keyManagerAPI} dappManagerHelper={dappManagerHelper} />} />)}
                            {dappManagerHelper && <Route path="/welcome" element={<Welcome logo={logo} title={getTitle()} dappManagerHelper={dappManagerHelper} />} />}
                            <Route path="/settings" element={<SettingsForm name={capitalizeFirstLetter(server_config.name)} settings={settings} applySettingsChanges={applySettingsChanges} installedPackages={packages} isAdminMode={isAdminMode} />} />
                            <Route path="/checksync" element={<CheckCheckPointSync restApi={restApi} network={server_config.network} packageUrl={packageUrl} />} />
                            {dappManagerHelper && <Route path="/admin" element={<AdminPage supervisorCtl={supervisorCtl} restApi={restApi} dappManagerHelper={dappManagerHelper} />} />}
                        </Routes>

                    </div>
                </div>
            </section>
        </div>
    )
}

export default Comp;
