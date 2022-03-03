import React from "react";
import axios from "axios";
import config from "../config";
import 'react-confirm-alert/src/react-confirm-alert.css'; // Import css
import rocketpoollogo from "../assets/rocketpool.png";
import autobahn from "autobahn-browser";
import MiniPoolStatus from "./MiniPoolStatus";
import NodeStatus from "./NodeStatus";
import NavigationBar from "./NavigationBar";
import Header from "./Header";
import Welcome from "./Welcome";
import WalletStatus from "./WalletStatus";
import SetupWizard from "./SetupWizard";
import bignumJSON from "json-bignum"
import AdminPage from "./AdminPage";
import NetworkBanner from "./NetworkBanner";
import Utils from "./utils";

const Comp = () => {
    const [network, setNetwork] = React.useState();
    const [utils, setUtils] = React.useState();

    const [walletStatus, setWalletStatus] = React.useState();
    const [minipoolStatus, setMinipoolStatus] = React.useState();
    const [nodeStatus, setNodeStatus] = React.useState();
    const [nodeSyncStatus, setNodeSyncStatus] = React.useState();
    const [nodeFee, setNodeFee] = React.useState();
    const [rplPriceData, setRplPriceData] = React.useState();

    const [wampSession, setWampSession] = React.useState();
    const [navBar, setNavBar] = React.useState();

    React.useEffect(() => {
        if (!navBar && walletStatus && minipoolStatus) {
            if (minipoolStatus.status === "success" && minipoolStatus.minipools && minipoolStatus.minipools.length > 0) {
                setNavBar("Status");
                return;
            }
            if (!walletStatus.walletInitialized) {
                setNavBar("Welcome");
                return;
            }
            if (walletStatus.passwordSet) {
                setNavBar("Setup");
                return;
            }
        }
    }, [walletStatus, minipoolStatus]);

    React.useEffect(() => {
        axios.get(`${config.api.HTTP}/network`).then((res) => {
            const network = res.data;
            setNetwork(network);
            console.log(`Using the ${network} network`);

            const utils = new Utils(network);
            setUtils(utils);
        })
    }, []);

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

    const rpdDaemon = async (command, callback) => {
        await axios.post(`${config.api.HTTP}/rpd`, { command: command }, { timeout: 5 * 60 * 1000 }).then((res) => {
            const data = bignumJSON.parse(res.data);
            console.log(`rocketpoold api ${command}: ` + res.data);
            // console.log('JSON: ' + bignumJSON.stringify(data))
            callback(data);
        })
    }

    const updateMiniPoolStatus = () => rpdDaemon("minipool status", (data) => setMinipoolStatus(data));
    const updateNodeStatus = () => rpdDaemon("node status", (data) => setNodeStatus(data));
    const updateNodeSyncStatus = () => rpdDaemon("node sync", (data) => setNodeSyncStatus(data));
    const updateWalletStatus = () => rpdDaemon("wallet status", (data) => setWalletStatus(data));
    const updateNodeFee = () => rpdDaemon("network node-fee", (data) => setNodeFee(data));
    const updateRplPriceData = () => rpdDaemon("network rpl-price", (data) => setRplPriceData(data));

    React.useEffect(() => {
        updateMiniPoolStatus();
        updateNodeStatus();
        updateNodeSyncStatus();
        updateWalletStatus();
        updateNodeFee();
        updateRplPriceData();
    }, []); // eslint-disable-line

    React.useEffect(() => {
        const interval = setInterval(() => {
            updateNodeFee();
            updateNodeSyncStatus();
            updateRplPriceData();
        }, 60 * 1000); // 60 seconds refresh
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="dashboard has-text-white">
            <NetworkBanner network={network} />
            <Header utils={utils} rocketpoollogo={rocketpoollogo} nodeSyncStatus={nodeSyncStatus} nodeFee={nodeFee} rplPriceData={rplPriceData} minipoolStatus={minipoolStatus} />
            <NavigationBar navBar={navBar} setNavBar={setNavBar} />

            {!wampSession && (
                <p>Avado Connection problem. Check your browser's console log for more details.</p>
            )}

            <section className="has-text-white">
                <div className="columns is-mobile">
                    <div className="column">
                        {navBar === "Welcome" && (
                            <div>
                                <Welcome nodeSyncStatus={nodeSyncStatus} setNavBar={setNavBar}/>
                            </div>
                        )}

                        {navBar === "Setup" && (
                            <div>
                                <SetupWizard
                                    utils={utils}
                                    walletStatus={walletStatus}
                                    updateWalletStatus={updateWalletStatus}
                                    nodeStatus={nodeStatus}
                                    updateNodeStatus={updateNodeStatus}
                                    rplPriceData={rplPriceData}
                                    minipoolStatus={minipoolStatus}
                                    updateMiniPoolStatus={updateMiniPoolStatus}
                                    nodeFee={nodeFee}
                                    setNavBar={setNavBar}
                                    rpdDaemon={rpdDaemon} />
                            </div>
                        )}

                        {navBar === "Status" && (
                            <div>
                                <div className="columns">
                                    <div className="column is-half">
                                        <NodeStatus utils={utils} nodeStatus={nodeStatus} updateNodeStatus={updateNodeStatus} nodeSyncStatus={nodeSyncStatus} />
                                    </div>
                                    <div className="column is-half">
                                        <WalletStatus utils={utils} nodeStatus={nodeStatus} updateNodeStatus={updateNodeStatus} />
                                    </div>
                                </div>
                                <br />
                                <MiniPoolStatus utils={utils} minipoolStatus={minipoolStatus} />
                            </div>
                        )}

                        {navBar === "Admin" && (
                            <AdminPage utils={utils} wampSession={wampSession} />
                        )}
                    </div>
                </div>
            </section>

        </div>

    )
}


export default Comp;