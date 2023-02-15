import React, { useCallback } from "react";
import { Route, Routes, useNavigate, useSearchParams } from "react-router-dom";

import NetworkBanner from "./shared/NetworkBanner";
import Header from "./shared/Header";
import SettingsForm from "./SettingsForm";
import MainPage from "./MainPage";
import AdminPage from "./AdminPage";
import NavigationBar from "./shared/NavigationBar";
import Welcome from "./shared/Welcome";

import nimbuslogo from "../assets/nimbus.png";
import defaultSettings from "./defaultsettings.json"
import { SettingsType } from "./shared/Types";
import { RestApi } from "./shared/RestApi";
import { SupervisorCtl } from "./shared/SupervisorCtl";
import { useWampSession } from "./shared/useWampSession"
import { DappManagerHelper } from "./shared/DappManagerHelper";
import FeeRecepientBanner from "./shared/FeeRecepientBanner";
import ExecutionEngineBanner from "./shared/ExecutionEngineBanner";
import CheckCheckPointSync from "./shared/CheckCheckPointSync";
import { NETWORK } from "./network"

export const packagePrefix = NETWORK === "mainnet" ? `nimbus` : `nimbus-${NETWORK}`;
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
    const keyManagerAPIUrl = `https://${packageUrl}:5052`;

    const getTitle = () => {
        switch (NETWORK) {
            case "gnosis": return "Avado Nimbus Gnosis"
            case "prater": return "Avado Nimbus Prater Testnet"
            default: return "Avado Nimbus";
        }
    }

    const getWikilink = () => {
        switch (NETWORK) {
            case "gnosis": return "https://docs.ava.do/packages/gnosis/"
            default: return "https://docs.ava.do/packages/nimbus/";
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

    const fetchApiToken = async (dappManagerHelper: DappManagerHelper, settings: SettingsType) => {
        const reschedule = async () => {
            // wait 3 seconds and try again
            await new Promise(r => setTimeout(r, 2000));
            fetchApiToken(dappManagerHelper, settings)
        }

        dappManagerHelper.getFileContentFromContainer(`/data/data-${NETWORK}/keymanagertoken`).then(
            (apiToken) => {
                if (apiToken) {
                    setKeyManagerAPI(new RestApi(keyManagerAPIUrl, apiToken))
                } else {
                    reschedule()
                }
            }
        )
    }

    React.useEffect(() => {
        if (!wampSession || !settings || !dappManagerHelper) {
            setRestApi(null);
            return;
        }
        if (!restApi) {
            setRestApi(new RestApi(restApiUrl))
        }

        if (!keyManagerAPI) {
            fetchApiToken(dappManagerHelper, settings)
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
            <NetworkBanner network={NETWORK} />

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
                        <Header restApi={restApi} logo={nimbuslogo} title={getTitle()} tagline="Nimbus beacon chain and validator" wikilink={getWikilink()} />

                        <NavigationBar />

                        <FeeRecepientBanner validators_proposer_default_fee_recipient={settings?.validators_proposer_default_fee_recipient} navigate={navigate} />
                        <ExecutionEngineBanner execution_engine={settings?.execution_engine} wikilink={getWikilink()} installedPackages={packages} client="Nimbus" />

                        <Routes>
                            <Route path="/" element={<MainPage settings={settings} restApi={restApi} keyManagerAPI={keyManagerAPI} dappManagerHelper={dappManagerHelper} />} />
                            {dappManagerHelper && <Route path="/welcome" element={<Welcome logo={nimbuslogo} title={getTitle()} dappManagerHelper={dappManagerHelper} />} />}
                            <Route path="/settings" element={<SettingsForm settings={settings} applySettingsChanges={applySettingsChanges} installedPackages={packages} isAdminMode={isAdminMode} />} />
                            <Route path="/checksync" element={<CheckCheckPointSync restApi={restApi} network={NETWORK} packageUrl={packageUrl} />} />
                            {dappManagerHelper && <Route path="/admin" element={<AdminPage supervisorCtl={supervisorCtl} restApi={restApi} dappManagerHelper={dappManagerHelper} />} />}
                        </Routes>

                    </div>
                </div>
            </section>
        </div>
    )
}

export default Comp;
