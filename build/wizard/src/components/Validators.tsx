import React from "react";
import axios from "axios";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSatelliteDish, faTrash } from "@fortawesome/free-solid-svg-icons";
import { confirmAlert } from 'react-confirm-alert';
import 'react-confirm-alert/src/react-confirm-alert.css'; // Import css
import AddValidator from "./AddValidator";
import { SettingsType } from "./Types";

interface Props {
    settings: SettingsType|undefined
    apiToken: string
}

interface ValidatorData {
    "index": string
    "balance": string,
    "status": string,
    "validator": {
        "pubkey": string,
        "withdrawal_credentials": string,
        "effective_balance": string,
        "slashed": boolean,
        "activation_eligibility_epoch": string,
        "activation_epoch": string,
        "exit_epoch": string,
        "withdrawable_epoch": string
    }
}

interface ConfiguringfeeRecipient {
    pubKey: string
    feerecipient: string
}

const Validators = ({ settings, apiToken }: Props) => {
    const [validatorData, setValidatorData] = React.useState<ValidatorData[]>();
    const [validators, setValidators] = React.useState<string[]>();
    const [feeRecipients, setFeeRecipients] = React.useState<string[]>();

    const [configuringfeeRecipient, setConfiguringfeeRecipient] = React.useState<ConfiguringfeeRecipient|null>();
    const [feeRecepientFieldValue, setFeeRecepientFieldValue] = React.useState<string>("");
    const [feeRecepientFieldValueError, setFeeRecepientFieldValueError] = React.useState<string|null>(null);

    const beaconchainUrl = (validatorPubkey: string, text: any) => {
        const beaconChainBaseUrl = ({
            "prater": "https://prater.beaconcha.in",
            "mainnet": "https://beaconcha.in",
            "kiln": "https://beaconchain.kiln.themerge.dev/"
        })[settings?.network??"mainnet"]
        return <a href={beaconChainBaseUrl + validatorPubkey}>{text ? text : validatorPubkey}</a>;
    }

    const updateValidators = async () => {
        if (apiToken) {
            return await axios.get("https://teku.my.ava.do:5052/eth/v1/keystores", {
                headers: {
                    Accept: "application/json",
                    Authorization: `Bearer ${apiToken}`
                }
            }).then((res) => {
                if (res.status === 200) {
                    setValidators(res.data.data.map((d: any) => d.validating_pubkey))
                }
            });
        }
    }

    React.useEffect(() => {
        if (apiToken) {
            updateValidators();
            // console.log(apiToken)
        }
    }, [apiToken]) // eslint-disable-line

    React.useEffect(() => {
        window.addEventListener('keyup', (e) => { if (e.key === "Escape") setConfiguringfeeRecipient(null) });
    }, [])


    // React.useEffect(() => {
    //     if (validatorData) {
    //         console.dir(validatorData);
    //     }
    // }, [validatorData])


    // React.useEffect(() => {
    //     if (feeRecipients) {
    //         console.dir(feeRecipients);
    //     }
    // }, [feeRecipients])

    React.useEffect(() => {

        const getFeeRecipient = async (pubKey: string) => {
            try {
                if (!settings?.validators_proposer_default_fee_recipient) {
                    return "Configure default setting first!"
                }
                return await axios.get(`https://teku.my.ava.do:5052/eth/v1/validator/${pubKey}/feerecipient`, {
                    headers: {
                        Accept: "application/json",
                        Authorization: `Bearer ${apiToken}`
                    }
                }).then((res) => {
                    if (res.status === 200) {
                        // console.log(res)
                        return res.data.data.ethaddress
                    } else {
                        return settings?.validators_proposer_default_fee_recipient
                    }
                });
            } catch (err) {
                console.log("Error in validators_proposer_default_fee_recipient", err)
                return settings?.validators_proposer_default_fee_recipient
            }

        }

        const getValidatorData = async (pubKey: string): Promise<ValidatorData> => {
            const nullValue = {
                "index": "0",
                "balance": "0",
                "status": "pending_initialized",
                "validator": {
                    "pubkey": pubKey,
                    "withdrawal_credentials": "0x0000000000000000000000000000000000000000000000000000000000000000",
                    "effective_balance": "00000000000",
                    "slashed": false,
                    "activation_eligibility_epoch": "0",
                    "activation_epoch": "0",
                    "exit_epoch": "0",
                    "withdrawable_epoch": "0"
                }
            };
            try {
                const res = await axios.get(`http://teku.my.ava.do:5051/eth/v1/beacon/states/finalized/validators/${pubKey}`);
                if (res.status === 200) {
                    // console.log(res.data.data)
                    return (res.data.data as ValidatorData);
                } else
                    return nullValue
            } catch (err) {
                return nullValue
            }

        }

        if (validators) {
            Promise.all(validators.map(pubKey => getValidatorData(pubKey))).then(result => setValidatorData(result))
            Promise.all(validators.map(pubKey => getFeeRecipient(pubKey))).then(result => setFeeRecipients(result))
        }
    }, [validators, apiToken, settings?.validators_proposer_default_fee_recipient]);

    function askConfirmationRemoveValidator(pubKey: string) {
        confirmAlert({
            message: `Are you sure you want to remove validator "${pubKey}"?`,
            buttons: [
                {
                    label: 'Remove',
                    onClick: () => removeValidator(pubKey)
                },
                {
                    label: 'Cancel',
                    onClick: () => { }
                }
            ]
        });
    }

    const downloadSlashingData = (data:string) => {
        const element = document.createElement("a");
        const file = new Blob([data], { type: 'text/json' });
        element.href = URL.createObjectURL(file);
        element.download = "slashing_protection.json";
        document.body.appendChild(element); // Required for this to work in FireFox
        element.click();
    }

    const removeValidator = (pubKey:string) => {
        //https://ethereum.github.io/keymanager-APIs/#/Local%20Key%20Manager/DeleteKeys
        const apiCall = async (pubKey:string) => {
            return await axios.delete("https://teku.my.ava.do:5052/eth/v1/keystores", {
                headers: { Authorization: `Bearer ${apiToken}` },
                data: { pubkeys: [pubKey] }
            }).then((res) => {
                console.dir(res)
                console.log(res)
                downloadSlashingData(res.data.slashing_protection)
                if (res.status === 200) {
                    updateValidators();
                }
            }).catch((e) => {
                console.log(e)
                console.dir(e)
            });
        }
        console.log("Deleting " + pubKey + " with token " + apiToken);
        apiCall(pubKey);
    }

    const getStatusColor = (status:string) => {
        switch (status) {
            // https://ethereum.github.io/beacon-APIs/#/ValidatorRequiredApi/getStateValidator
            case "pending_initialized": return "is-info" // When the first deposit is processed, but not enough funds are available (or not yet the end of the first epoch) to get validator into the activation queue.
            case "pending_queued": return "is-info" // When validator is waiting to get activated, and have enough funds etc. while in the queue, validator activation epoch keeps changing until it gets to the front and make it through (finalization is a requirement here too).
            case "active_ongoing": return "is-success" // When validator must be attesting, and have not initiated any exit.
            case "active_exiting": return "is-warning" // When validator is still active, but filed a voluntary request to exit.
            case "active_slashed": return "is-danger"// When validator is still active, but have a slashed status and is scheduled to exit.
            case "exited_unslashed": return "is-info"// When validator has reached reguler exit epoch, not being slashed, and doesn't have to attest any more, but cannot withdraw yet.
            case "exited_slashed": return "is-danger"// When validator has reached reguler exit epoch, but was slashed, have to wait for a longer withdrawal period.
            case "withdrawal_possible": return "is-info"// After validator has exited, a while later is permitted to move funds, and is truly out of the system.
            case "withdrawal_done": return "is-info"// (not possible in phase0, except slashing full balance)// actually having moved funds away
            default: return ""
        }
    }

    const configureFeeRecipient = (pubKey:string, feeRecipient:string) => {
        if (settings?.validators_proposer_default_fee_recipient) {
            setConfiguringfeeRecipient({ pubKey: pubKey, feerecipient: feeRecipient })
            setFeeRecepientFieldValue(feeRecipient)
        } else {
            const element = document.getElementById("validators_proposer_default_fee_recipient");
            if (element) {
                element.scrollIntoView();
            }
        }
    }

    const saveFeeRecipient = async (pubKey:string, feeRecipientAddress:string) => {
        if (feeRecipientAddress) {
            try {
                return await axios.post(`https://teku.my.ava.do:5052/eth/v1/validator/${pubKey}/feerecipient`, {
                    "ethaddress": feeRecipientAddress
                }, {
                    headers: {
                        Authorization: `Bearer ${apiToken}`
                    }
                }).then((res) => {
                    if (res.status !== 202) {
                        setFeeRecepientFieldValueError(res.data.message)
                        console.log(res.data)
                    } else {
                        console.log("Configured fee recepient via key manager: ", res)
                        setFeeRecepientFieldValueError(null)
                        setConfiguringfeeRecipient(null)
                        updateValidators()
                    }
                });
            } catch (e:any) {
                console.log("error", e.response.data.message)
                setFeeRecepientFieldValueError(e.response.data.message)
            }
        } else {
            try {
                return await axios.delete(`https://teku.my.ava.do:5052/eth/v1/validator/${pubKey}/feerecipient`, {
                    headers: {
                        Authorization: `Bearer ${apiToken}`
                    }
                }).then((res) => {
                    if (res.status !== 204) {
                        setFeeRecepientFieldValueError(res.data.message)
                        console.log(res.data)
                    } else {
                        console.log("Configured fee recipient via key manager: ", res)
                        setFeeRecepientFieldValueError(null)
                        setConfiguringfeeRecipient(null)
                        updateValidators()
                    }
                });
            } catch (e:any) {
                console.log("error", e.response.data.message)
                setFeeRecepientFieldValueError(e.response.data.message)
            }
        }
    }

    return (
        <div>
            {validators && validatorData && feeRecipients && (
                <>
                    <div id="modal-js-example" className={"modal is-clipped" + (configuringfeeRecipient ? " is-active" : "")}>
                        <div className="modal-background"></div>

                        <div className="modal-content">
                            <div className="box">
                                {configuringfeeRecipient && (<p>Configure the <b>fee recepient address</b> for {beaconchainUrl("/validator/" + configuringfeeRecipient.pubKey, <abbr title={configuringfeeRecipient.pubKey}>{configuringfeeRecipient.pubKey.substring(0, 10) + "…"}</abbr>)}</p>)}
                                <br />
                                <p>Enter a valid address to set a fee recipient for this specific validator, or enter an empty address to use the default fee recipient setting ({settings?.validators_proposer_default_fee_recipient}):</p>

                                <div className="field">
                                    {/* <label className="label has-text-black">Fee recipient address</label> */}
                                    <div className="control">
                                        <input className={"input has-text-black" + (feeRecepientFieldValueError ? " is-danger" : "")} type="text" value={feeRecepientFieldValue === settings?.validators_proposer_default_fee_recipient ? "" : feeRecepientFieldValue} onChange={e => setFeeRecepientFieldValue(e.target.value)} />
                                    </div>
                                    {feeRecepientFieldValueError && (
                                        <p className="help is-danger">{feeRecepientFieldValueError}</p>
                                    )}
                                </div>

                                <button className="button" onClick={() => setConfiguringfeeRecipient(null)}>Cancel</button>
                                {configuringfeeRecipient && (<button className="button" onClick={() => saveFeeRecipient(configuringfeeRecipient.pubKey, feeRecepientFieldValue)}>Save</button>)}

                            </div>
                        </div>

                        <button className="modal-close is-large" aria-label="close" onClick={() => setConfiguringfeeRecipient(null)}></button>
                    </div>
                    <div className="notification is-success">
                        {beaconchainUrl("/dashboard?validators=" + validatorData.map(v => v.index).join(","), <>Beacon Chain Validator DashBoard <FontAwesomeIcon className="icon" icon={faSatelliteDish} /></>)}
                    </div>
                    <table className="table">
                        <thead>
                            <tr>
                                <th></th>
                                <th>Public key</th>
                                <th>Index</th>
                                <th>Balance</th>
                                <th>Effective Balance</th>
                                {/* <th>Activation Epoch</th> */}
                                {/* <th>Exit Epoch</th> */}
                                <th>Fee recipient</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {validatorData.map((validator, i) =>
                                <tr key={validator.index}>
                                    <td>{beaconchainUrl("/validator/" + validator.index, <FontAwesomeIcon className="icon" icon={faSatelliteDish} />)}</td>
                                    <td>{beaconchainUrl("/validator/" + validator.index, <abbr title={validator.validator.pubkey}>{validator.validator.pubkey.substring(0, 10) + "…"}</abbr>)}</td>
                                    <td>{beaconchainUrl("/validator/" + validator.index, validator.index)}</td>
                                    <td>{(parseFloat(validator.balance) / 1000000000.0).toFixed(4)}</td>
                                    <td>{(parseFloat(validator.validator.effective_balance) / 1000000000.0).toFixed(4)}</td>
                                    {/* <td>{validator.validator.activation_epoch}</td> */}
                                    {/* <td>{validator.validator.exit_epoch}</td> */}
                                    <td>
                                        {/* eslint-disable-next-line */}
                                        <a className="link" onClick={() => configureFeeRecipient(validator.validator.pubkey, feeRecipients[i])}>
                                            <abbr title={feeRecipients[i]}>{feeRecipients[i]?.substring(0, 10) + "…"}</abbr>
                                        </a>
                                    </td>
                                    <td><span className={"tag " + getStatusColor(validator.status)}>{validator.status}</span></td>
                                    <td><button className="button is-text has-text-grey-light" onClick={() => askConfirmationRemoveValidator(validator.validator.pubkey)}><FontAwesomeIcon className="icon" icon={faTrash} /></button></td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </>
            )}
            <AddValidator apiToken={apiToken} updateValidators={updateValidators} />
        </div>
    );
};

export default Validators