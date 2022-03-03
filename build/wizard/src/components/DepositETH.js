import React from "react";
import BN from "bn.js"
import { confirmAlert } from 'react-confirm-alert';
import 'react-confirm-alert/src/react-confirm-alert.css';
import Spinner from "./Spinner";
import config from "../config";
import web3 from "web3";

const DepositETH = ({ utils, nodeStatus, nodeFee, rplPriceData, rplAllowanceOK, updateNodeStatus, rpdDaemon }) => {


    const [ethButtonDisabled, setEthButtonDisabled] = React.useState(true);
    const [feedback, setFeedback] = React.useState("");
    const [txHash, setTxHash] = React.useState();
    const [waitingForTx, setWaitingForTx] = React.useState(false);
    const [selectedNodeFee, setSelectedNodeFee] = React.useState();
    const ETHDepositAmmount = 16000000000000000000;

    const getNodeFeeWithSlippage = (nodeFee) => nodeFee * 0.97;

    React.useEffect(() => {
        if (waitingForTx)
            return;

        setEthButtonDisabled(true); //set default
        if (nodeStatus && rplPriceData && rplAllowanceOK) {
            if (nodeStatus.rplStake < rplPriceData.minPerMinipoolRplStake) {
                setFeedback("You need to stake RPL first")
            } else {
                if (nodeStatus.accountBalances.eth / 1000000000000000000 < 16) {
                    setFeedback("There is not enough ETH in your wallet. You need at least 16 ETH + gas.")
                } else {
                    rpdDaemon(`node can-deposit ${ETHDepositAmmount} ${selectedNodeFee} 0`, (data) => {
                        if (data.status === "error") {
                            setFeedback(data.error);
                        } else {
                            setFeedback("");
                            setEthButtonDisabled(false);
                        }
                    });
                }
            }
        }

        if (nodeFee && nodeFee?.status==="success" && !selectedNodeFee) {
            setSelectedNodeFee(getNodeFeeWithSlippage(nodeFee.nodeFee)); // allow 3% slippage by default
        }

    }, [nodeStatus, rplPriceData, rplAllowanceOK, nodeFee, waitingForTx]);


    React.useEffect(() => {
        if (waitingForTx && txHash) {
            rpdDaemon(`wait ${txHash}`, (data) => {
                const w3 = new web3(utils.wsProvider());
                w3.eth.getTransactionReceipt(txHash).then((receipt) => {
                    console.log(receipt);
                    setWaitingForTx(false);
                    updateNodeStatus();
                });
            });
        }
    }, [waitingForTx, txHash, utils]);

    const depositEth = () => {
        confirmAlert({
            title: '',
            message: 'Are you sure you want to deposit your 16 ETH now and create your minipool?',
            buttons: [
                {
                    label: 'Yes',
                    onClick: () => {
                        setEthButtonDisabled(true);
                        rpdDaemon(`node deposit ${ETHDepositAmmount} ${selectedNodeFee} 0`, (data) => {  //   rocketpool api node deposit amount min-fee salt
                            //{"status":"success","error":"","txHash":"0x6c8958917414479763aaa65dbff4b00e52d9ef699d64dbd0827a45e1fe8aee38","minipoolAddress":"0xc43a2d435bd48bde1e000c07e89f3e6ebe9161d4","validatorPubkey":"ac9cb87a11fd8c55a9529108964786f11623717a6e3af0db3cd5fde2da5c6a7a4f89e52d13770ad6bc080de1b63427a1","scrubPeriod":3600000000000}
                            if (data.status === "error") {
                                setFeedback(data.error);
                            }
                            setTxHash(data.txHash);
                            setWaitingForTx(true);
                        })
                    }
                },
                {
                    label: 'No',
                    onClick: () => { }
                }
            ]
        });
    }

    const slider = (e) => {
        setSelectedNodeFee(e.target.value);
    }

    return (
        <div className="">
            <h4 className="title is-4 has-text-white">3. Deposit 16 ETH</h4>
            {nodeStatus && nodeStatus.minipoolCounts.total > 0 && (
                <>
                    <span className="tag is-success">16 ETH successfully deposited.</span>
                </>
            )}

            {nodeStatus && nodeFee?.status==="succes" && nodeStatus.minipoolCounts.total === 0 && (
                <>
                    <p>The estimated commission you will receive from other deposits is +/- {utils.displayAsPercentage(selectedNodeFee * 100)}.<br />For more info on this check the <a target="_blank" href="https://wiki.ava.do/en/tutorials/rocketpool">Avado Rocket Pool Wiki page</a></p>
                    <br />
                    {/* <div className="field">
                        Your minimum nodeFee: <input id="sliderWithValue" className="slider has-output" step="0.01" min={nodeFee.minNodeFee} max={nodeFee.maxNodeFee} value={selectedNodeFee} defaultValue={nodeFee.nodeFee} type="range" onChange={slider} />
                        {utils.displayAsPercentage(selectedNodeFee * 100)} <a onClick={()=>{setSelectedNodeFee(getNodeFeeWithSlippage(nodeFee.nodeFee))}}>reset to default</a>
                    </div> */}
                    <div className="field">
                        <button className="button" onClick={depositEth} disabled={ethButtonDisabled}>Deposit 16 ETH and create minipool{waitingForTx ? <Spinner /> : ""}</button>
                    </div>
                    {feedback && (
                        <p className="help is-danger">{feedback}</p>
                    )}
                    <br />
                </>
            )}
            {txHash && (
                <>
                    <p>{utils.etherscanTransactionUrl(txHash, "Transaction details on Etherscan")}</p>
                    <br />
                </>
            )}
        </div>);
}


export default DepositETH