import React from "react";
import web3 from "web3";

import { confirmAlert } from 'react-confirm-alert';
import 'react-confirm-alert/src/react-confirm-alert.css';
import config from "../config";
import Spinner from "./Spinner";

const RegisterNode = ({ utils, nodeStatus, updateNodeStatus, rpdDaemon }) => {
    const [buttonDisabled, setButtonDisabled] = React.useState(true);
    const [txHash, setTxHash] = React.useState();
    const [waitingForTx, setWaitingForTx] = React.useState(false);
    const [error, setError] = React.useState();
    const [gasInfo, setGasInfo] = React.useState();

    React.useEffect(() => {
        setButtonDisabled(true); //set default
        if (waitingForTx)
            return;
        if (nodeStatus && !nodeStatus.registered && nodeStatus.accountBalances.eth > 0) {
            rpdDaemon(`node can-register ${timeZone()}`, (data) => {
                if (data.status === "error") {                    
                    setError("Error running can-register: " + data.error + (data.registrationDisabled?" Node registrations are currently disabled.":""));
                    return;
                }
                if (data.canRegister)
                    setButtonDisabled(false);
                setGasInfo(data.gasInfo);
            });
        }
    }, [nodeStatus]);

    React.useEffect(() => {
        if (waitingForTx) {
            rpdDaemon(`wait ${txHash}`, (data) => {
                const w3 = new web3(utils.wsProvider());
                w3.eth.getTransactionReceipt(txHash).then((receipt) => {
                    console.log(receipt);
                    setWaitingForTx(false);
                    updateNodeStatus();
                });
            });
        }

    }, [waitingForTx,utils]);

    const timeZone = () => {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone
        } catch (e) {
            return "Etc/UTC"; // Default: https://docs.rocketpool.net/guides/node/prepare-node.html#registering-your-node-with-the-network
        }
    }

    const registerNode = () => {
        confirmAlert({
            title: 'Are you sure you want to register this node?',
            message: 'Registering a node consumes gas (ETH)',
            buttons: [
                {
                    label: 'Yes',
                    onClick: () => rpdDaemon(`node register ${timeZone()}`, (data) => {
                        // "data": "{\"status\":\"success\",\"error\":\"\",\"txHash\":\"0x0691e410226264f411ee7a66285a78ec5c5776352cd038f66fb651ba10365381\"}\n",
                        updateNodeStatus();
                        setTxHash(data.txHash);
                        setWaitingForTx(true);
                        setButtonDisabled(true);
                    })
                },
                {
                    label: 'No',
                    onClick: () => { }
                }
            ]
        });
    }

    const toGwei = (wei) => parseFloat(web3.utils.fromWei(wei.toString(), 'gwei')).toFixed(4)

    return (
        <div>
            {nodeStatus && !nodeStatus.registered && (
                <>
                    <h2 className="title is-3 has-text-white">Register Node</h2>
                    {/* {gasInfo && <p className="help is-help">Estimated gas limit {toGwei(gasInfo.estGasLimit)} gwei, Safe gas limit {toGwei(gasInfo.safeGasLimit)} gwei</p>} */}
                    <button className="button" onClick={registerNode} disabled={buttonDisabled}>Register Node{waitingForTx? <Spinner/>:""}</button>
                    {/* {waitingForTx && (
                        <p><span className="icon"><img alt="spinner" src={spinner} /></span></p>
                    )} */}
                    {error && (<p className="help is-danger">{error}</p>)}
                    {txHash && (
                        <p>{utils.etherscanTransactionUrl(txHash, "Transaction details on Etherscan")}</p>
                    )}
                </>
            )}
        </div>
    );
};

export default RegisterNode