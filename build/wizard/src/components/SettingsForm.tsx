import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrash } from "@fortawesome/free-solid-svg-icons";
import { Formik, Field, Form, FieldArray } from 'formik';
import * as yup from 'yup';
import { confirmAlert } from 'react-confirm-alert';
import 'react-confirm-alert/src/react-confirm-alert.css'; // Import css
import { Network, SettingsType, supportedNetworks } from "./Types";
import defaultSettings from "./defaultsettings.json"

interface Props {
    settings: SettingsType | undefined,
    applySettingsChanges: (settings: any) => void
    installedPackages: string[] | undefined
}

const Comp = ({ settings, applySettingsChanges, installedPackages }: Props) => {

    const settingsSchema = yup.object().shape({
        eth1_endpoints: yup.array().label("eth1-endpoints").min(1).required('Required').of(yup.string().url().required('Required')),
        validators_graffiti: yup.string().label("validators-graffiti").max(32, 'The graffiti can be maximum 32 characters long').optional(),
        validators_proposer_default_fee_recipient: yup.string().label("validators-proposer-default-fee-recipient").matches(/^0x[a-fA-F0-9]{40}$/).required('Required'),
        p2p_peer_lower_bound: yup.number().label("p2p-peer-lower-bound").positive().integer().required('Required'),
        p2p_peer_upper_bound: yup.number().label("p2p-peer-upper-bound").positive().integer().required('Required'),
        initial_state: yup.string().label("initial-state").url().optional()
    });

    type execution_engine = {
        name: string
        packagename: string
        ee_endpoint: string
        jwttokenpath: string
        network: Network
    }

    const execution_engines: execution_engine[] = [
        {
            name: "Geth Mainnet",
            packagename: "ethchain-geth.public.dappnode.eth",
            ee_endpoint: "http://ethchain-geth.my.ava.do:8551",
            jwttokenpath: "",
            network: "mainnet"
        }, {
            name: "Geth Goerli Testnet",
            packagename: "goerli-geth.avado.dnp.dappnode.eth",
            ee_endpoint: "http://goerli-geth.my.ava.do:8551",
            jwttokenpath: "",
            network: "prater"
        }, {
            name: "Nethermind",
            packagename: "avado-dnp-nethermind.public.dappnode.eth",
            ee_endpoint: "avado-dnp-nethermind.my.ava.do:8551",
            jwttokenpath: "",
            network: "mainnet"
        }, {
            name: "Geth Kiln Testnet",
            packagename: "geth-kiln.avado.dnp.dappnode.eth",
            ee_endpoint: "http://geth-kiln.my.ava.do:8551",
            jwttokenpath: "",
            network: "kiln"
        }
    ]

    const supportedExecutionEngines = (installedPackages: string[] | undefined, settings: SettingsType) => {
        if (installedPackages && settings) {
            return execution_engines.filter(ee => ee.network === settings.network && installedPackages.includes(ee.packagename))
        }
        return []
    }

    const applyChanges = (values: any) => {
        console.log(values)
        values.ee_endpoint = execution_engines.find(ee => ee.packagename === values.execution_engine)!.ee_endpoint
        console.log(values)
        applySettingsChanges(values)
    }

    const confirmResetDefaults = () => {
        confirmAlert({
            message: `Are you sure you want to reset to the default settings?`,
            buttons: [
                {
                    label: 'Reset',
                    onClick: () => {
                        applySettingsChanges(defaultSettings)
                    }
                },
                {
                    label: 'Cancel',
                    onClick: () => { }
                }
            ]
        });
    }

    return <>
        <h2 className="title is-2 has-text-white">Settings</h2>
        {
            !settings && (
                <p>Loading settings...</p>
            )
        }
        {settings && (
            <div>
                <Formik
                    initialValues={settings}
                    validationSchema={settingsSchema}
                    validateOnMount
                    enableReinitialize
                    onSubmit={() => { }}
                >
                    {({ values, errors, touched, isValid, dirty, setValues }) => {
                        return <Form>
                            <div className="field">
                                <label className="label" htmlFor="validators_graffiti">Validators graffiti</label>
                                <div className="control">
                                    <Field className={"input" + (errors?.validators_graffiti ? " is-danger" : "")} id="validators_graffiti" name="validators_graffiti" placeholder="Avado Teku" />
                                    {errors.validators_graffiti ? (
                                        <p className="help is-danger">{errors.validators_graffiti.toString()}</p>
                                    ) : null}
                                </div>
                            </div>

                            <div className="field">
                                <label className="label" htmlFor="p2p_peer_lower_bound">Lower bound on the target number of peers. Teku will actively seek new peers if the number of peers falls below this value. The default is {defaultSettings.p2p_peer_lower_bound}</label>
                                <div className="control">
                                    <Field className={"input" + (errors?.p2p_peer_lower_bound ? " is-danger" : "")} id="p2p_peer_lower_bound" name="p2p_peer_lower_bound" />
                                    {errors.p2p_peer_lower_bound ? (
                                        <p className="help is-danger">{errors.p2p_peer_lower_bound.toString()}</p>
                                    ) : null}
                                </div>
                            </div>

                            <div className="field">
                                <label className="label" htmlFor="p2p_peer_upper_bound">Upper bound on the target number of peers. Teku will refuse new peer requests that would cause the number of peers to exceed this value. The default is {defaultSettings.p2p_peer_upper_bound}</label>
                                <div className="control">
                                    <Field className={"input" + (errors?.p2p_peer_upper_bound ? " is-danger" : "")} id="p2p_peer_upper_bound" name="p2p_peer_upper_bound" />
                                    {errors.p2p_peer_upper_bound ? (
                                        <p className="help is-danger">{errors.p2p_peer_upper_bound.toString()}</p>
                                    ) : null}
                                </div>
                            </div>

                            <div className="field">
                                <label className="label" htmlFor="initial_state">Initial State: Start Teku from a recent finalized checkpoint state rather than syncing from genesis. URL to an SSZ-encoded state. The default uses a checkpoint cached on an Avado server</label>
                                <div className="control">
                                    <Field className={"input" + (errors?.initial_state ? " is-danger" : "")} id="initial_state" name="initial_state" />
                                    {errors.initial_state ? (
                                        <p className="help is-danger">{errors.initial_state.toString()}</p>
                                    ) : null}
                                </div>
                            </div>

                            <label className="field-label is-normal" htmlFor="eth1_endpoints">Execution layer (ETH1) endpoints</label>
                            <div>
                                <FieldArray name="eth1_endpoints">
                                    {({ remove, push }) => (
                                        <>
                                            {values.eth1_endpoints?.length > 0 &&
                                                values.eth1_endpoints.map((eth1_endpoint: any, index: number) => (
                                                    <div key={`eth1_endpoints.${index}`}>
                                                        <div className="field has-addons">
                                                            <div className="field-label is-normal">
                                                                <label className="label">Endpoint #{index + 1}</label>
                                                            </div>
                                                            <div className="field-body">
                                                                <div className="field">
                                                                    <p className="control">
                                                                        <Field
                                                                            // @ts-ignore
                                                                            className={"input" + (errors?.eth1_endpoints?.at(index) ? " is-danger" : "")}
                                                                            name={`eth1_endpoints.${index}`}
                                                                            id={`eth1_endpoints.${index}`}
                                                                            placeholder="ETH1 endpoint"
                                                                            type="text"
                                                                        />
                                                                    </p>
                                                                    {
                                                                        // @ts-ignore
                                                                        errors?.eth1_endpoints?.at(index)
                                                                            ? (
                                                                                <p className="help is-danger">{
                                                                                    //@ts-ignore
                                                                                    errors.eth1_endpoints[index]}</p>
                                                                            ) : null
                                                                    }
                                                                    {/* <ErrorMessage
                                                                        name={`eth1_endpoints.${index}.eth1_endpoint`}
                                                                        component="div"
                                                                        className="help is-danger"
                                                                        type="p"
                                                                    /> */}
                                                                </div>
                                                            </div>
                                                            <div className="control">
                                                                <button className="button" onClick={() => remove(index)}><FontAwesomeIcon className="icon" icon={faTrash} /></button>
                                                            </div>
                                                        </div>
                                                    </div>

                                                ))}
                                            <div className="field has-addons">
                                                <div className="field-label is-normal">
                                                    <label className="label"></label>
                                                </div>
                                                <div className="field-body">
                                                    <div className="field">
                                                        <p className="control">
                                                            <button
                                                                type="button"
                                                                className="button"
                                                                onClick={() => push("")}
                                                            >
                                                                Add extra (fallback) endpoint
                                                            </button>
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </FieldArray>
                            </div>

                            {supportedExecutionEngines && (
                                <div className="field">
                                    <label className="label" htmlFor="execution_engine">Execution Engine</label>
                                    <div className="control">
                                        <Field name="execution_engine" as="select" className="select">
                                            {supportedExecutionEngines(installedPackages, values).map(ee =>
                                                <option key={ee.packagename} value={ee.packagename} label={ee.name} />
                                            )}
                                        </Field>
                                        {!values.execution_engine || supportedExecutionEngines(installedPackages, values).length === 0 ? (
                                            <p className="help is-danger">No suitable execution engine found.</p>
                                        ) : null}
                                    </div>
                                </div>
                            )}

                            {/* eslint-disable-next-line */}
                            <a id="validators_proposer_default_fee_recipient">
                                <div className="field">
                                    <label className="label" htmlFor="validators_proposer_default_fee_recipient">Default transaction fee recipient for the validators (after the Merge). The fee recipient can be overriden per validator by clicking the fee recipient value of any validator in the validator list above.</label>
                                    <div className="control">
                                        <Field className={"input" + (errors?.validators_proposer_default_fee_recipient ? " is-danger" : "")}
                                            id="validators_proposer_default_fee_recipient"
                                            name="validators_proposer_default_fee_recipient"
                                            placeholder="TODO: enter fee recipient address here" />
                                        {errors.validators_proposer_default_fee_recipient ? (
                                            <p className="help is-danger">{errors.validators_proposer_default_fee_recipient.toString()}</p>
                                        ) : null}
                                    </div>
                                </div>
                            </a>

                            <div className="field">
                                <label className="label" htmlFor="network">Network. Only change this if you know what you are doing</label>
                                <div className="control">
                                    <Field name="network" as="select" className="select">
                                        {supportedNetworks.map(n => <option key={n} value={n} label={n} />)}
                                    </Field>
                                    {values.network !== settings.network ? (
                                        <p className="help is-warning">When the network is changed, Teku needs to sync to the new network. This can be a long operation. Make sure to update the ETH1 endpoints too.</p>
                                    ) : null}
                                </div>
                            </div>

                            {/* <div>
                                <div className="container">
                                    <pre className="transcript">
                                        Errors : {JSON.stringify(errors)}<br />
                                        Touched : {JSON.stringify(touched)}
                                    </pre>
                                </div>
                            </div> */}

                            <div className="field is-grouped">
                                <div className="control">
                                    <button disabled={!(isValid && dirty)} className="button" onClick={() => applyChanges(values)}>Apply changes</button>
                                </div>
                                <div className="control">
                                    <button disabled={!dirty} className="button is-warning" onClick={() => setValues(settings)}>Revert changes</button>
                                </div>
                                <div className="control">
                                    <div className="button is-danger" onClick={() => confirmResetDefaults()}>Reset defaults</div>
                                </div>
                            </div>
                        </Form>
                    }}
                </Formik>
            </div>
        )}
    </>
}

export default Comp;