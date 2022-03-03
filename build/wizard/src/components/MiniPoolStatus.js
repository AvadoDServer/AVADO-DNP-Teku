import React from "react";
import beaconchainlogo from "../assets/beaconchain.png";

const MiniPoolStatus = ({ utils, minipoolStatus }) => {
    const miniPoolSteps = [
        "Initializing",
        "Prelaunch",
        "Staking",
        // "Exited"
    ];

    const isHollow = (step, minipool) => {
        if (step === "Staking")
            return !minipool.validator.active;
        return false;
    
    }
    const miniPoolStepsComment = (step) => {
        if (step === "Prelaunch") return "(~12 hours)";
        else return "";
    };
    
    // https://docs.rocketpool.net/guides/node/create-validator.html#depositing-eth-and-creating-a-minipool
    //minipool status: initialized -> prelaunch (currently 12 hours) -> staking

    // https://kb.beaconcha.in/ethereum-2.0-depositing

    // {"status":"success","error":"","minipools":[{"address":"0x990074a02a06c27b9e13869cfe937efaa0de0b92","validatorPubkey":"996a3d7f3da4c6ed02f66243b849c10feaae37c38bb9be8657d8647216997b9a19827bdb20dde6b412453512770c2900","status":{"status":"Staking","statusBlock":6233072,"statusTime":"2022-01-20T10:01:08Z"},"depositType":"Full","node":{"address":"0x1192b62c60aad67a89196a0cefd42ed85d27506e","fee":0.16840959301290093,"depositBalance":16000000000000000000,"refundBalance":16000000000000000000,"depositAssigned":true},"user":{"depositBalance":16000000000000000000,"depositAssigned":true,"depositAssignedTime":"2022-01-10T13:47:50Z"},"balances":{"eth":16000000000000000000,"reth":0,"rpl":0,"fixedSupplyRpl":0},"validator":{"exists":true,"active":false,"index":271831,"balance":32000000000000000000,"nodeBalance":16000000000000000000},"refundAvailable":true,"withdrawalAvailable":false,"closeAvailable":false,"finalised":false,"useLatestDelegate":false,"delegate":"0xc6b40c1a317144a09c303c504cb525ee68ab8c8e","previousDelegate":"0x0000000000000000000000000000000000000000","effectiveDelegate":"0xc6b40c1a317144a09c303c504cb525ee68ab8c8e"}],"latestDelegate":"0xc6b40c1a317144a09c303c504cb525ee68ab8c8e"}



    if (!minipoolStatus || !minipoolStatus.minipools)
        return (
            <>
            </>
        );
    const minipool0 = minipoolStatus.minipools[0];
    return (
        <div>
            <h2 className="title is-3 has-text-white">Minipool status</h2>
            {minipool0 && minipool0.status && (
                <div> {/* https://octoshrimpy.github.io/bulma-o-steps/ */}
                    <div className="columns">
                        <div className="column">
                            <ul className="steps has-content-centered">
                                {miniPoolSteps.map( (element) => 
                                    <li className={"steps-segment" + (element === minipool0.status.status ? " is-active" : "")} key={element}>
                                        <span className={"steps-marker"+ (element === minipool0.status.status && isHollow(element, minipool0)?" is-hollow":"")}></span>
                                        <div className="steps-content">
                                            <p className="is-size-4 has-text-white">{element}</p>
                                            <div className="extra-data has-text-white">{miniPoolStepsComment(element)}</div>
                                        </div>
                                    </li>
                                )}
                            </ul>
                        </div>
                    </div>

                    {utils.beaconchainUrl(minipool0.validator.index, <img src={beaconchainlogo} alt="More info on beaconcha.in" />)}

                    <table className="table">
                        <tbody>
                            <tr><td><b>Address</b></td><td>{utils.etherscanAddressUrl(minipool0.address)}</td></tr>
                            <tr><td><b>Status updated</b></td><td>{minipool0.status.statusTime}</td></tr>
                            <tr><td><b>Node fee</b></td><td>{utils.displayAsPercentage(minipool0.node.fee*100)}</td></tr>
                            <tr><td><b>Node deposit</b></td><td>{utils.displayAsETH(minipool0.node.depositBalance)} ETH</td></tr>
                            <tr><td><b>RP ETH assigned</b></td><td>{minipool0.user.depositAssignedTime}</td></tr>
                            <tr><td><b>RP deposit</b></td><td>{utils.displayAsETH(minipool0.user.depositBalance)} ETH</td></tr>
                            <tr><td><b>Validator pubkey</b></td><td>{utils.beaconchainUrl(minipool0.validatorPubkey, "0x" + minipool0.validatorPubkey.substring(0, 20) + "..." + minipool0.validatorPubkey.substring(76))}</td></tr>
                            <tr><td><b>Validator index</b></td><td>{utils.beaconchainUrl(minipool0.validator.index)}</td></tr>
                            <tr><td><b>Validator active</b></td><td>{minipool0.validator.active ? "yes" : "no"}</td></tr>
                            <tr><td><b>Validator balance</b></td><td>{utils.displayAsETH(minipool0.validator.balance)}</td></tr>
                            <tr><td><b>Expected rewards</b></td><td>{utils.displayAsETH(minipool0.validator.nodeBalance)}</td></tr>
                        </tbody>
                    </table>
                    <br />
                    <table className="table">
                        <tbody>
                            <tr><td><b>Use latest delegate</b></td><td>{minipool0.useLatestDelegate ? "yes" : "no"}</td></tr>
                            <tr><td><b>Delegate address</b></td><td>{utils.etherscanAddressUrl(minipool0.delegate)}</td></tr>
                            <tr><td><b>Effective delegate</b></td><td>{utils.etherscanAddressUrl(minipool0.effectiveDelegate)}</td></tr>
                        </tbody>
                    </table>
                    <p>{utils.beaconchainUrl(minipool0.validatorPubkey, "More validator info on the Ethereum 2.0 Beacon Chain Explorer")}</p>
                </div>
            )}
        </div>
    );
};

export default MiniPoolStatus