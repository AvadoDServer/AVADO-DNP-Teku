import React from "react";
import axios from "axios";
import config from "../config";
import { confirmAlert } from 'react-confirm-alert';
import 'react-confirm-alert/src/react-confirm-alert.css'; // Import css

const packageName = "rocketpool.avado.dnp.dappnode.eth";

const Comp = ({ session }) => {

    const [dataresult, setDataresult] = React.useState();
    const [dataSuccess, setDataSuccess] = React.useState();
    const [restartresult, setRestartresult] = React.useState();

    const restart = async () => {
        const res = JSON.parse(await session.call("restartPackage.dappmanager.dnp.dappnode.eth", [],
            {
                id: packageName,
            }));
        if (res.success === true) {
            setRestartresult("restarting package - wait a few minutes and reload this page");
        }
    }

    async function restoreBackup(file) {
        const data = new FormData();
        data.append('file', file);
        axios.post(`${config.api.HTTP}/restore-backup`, data).then(res => {
            console.dir(res);
            console.log("OK?")
            setDataresult(res.data.message);
            setDataSuccess(res.data.code === 200);
        }).catch(err => {
            console.log(err);
            setDataresult(err.data.message);
            setDataSuccess(false);
        });
    }

    async function askConfirmationRestoreBackup(file) {
        confirmAlert({
            title: `Are you sure you want to restore from "${file.name}"?`,
            message: 'This will overwrite your current Rocket Pool configuration',
            buttons: [
                {
                    label: 'Yes',
                    onClick: () => restoreBackup(file)
                },
                {
                    label: 'No',
                    onClick: () => { }
                }
            ]
        });
    }

    return (
        <>
            <div>
                rocket-pool-backup.zip &nbsp;
                <input
                    type="file"
                    onChange={e => askConfirmationRestoreBackup(e.target.files[0])}
                />
                {dataresult && (<div className={"is-size-7" + (dataSuccess ? "" : " has-text-danger")}>{dataresult}</div>)}
            </div>

            {dataresult && dataSuccess && (
                <>
                    <button className="button" onClick={restart}>restart node</button>
                    {restartresult && (<div className="is-size-7">{restartresult}</div>)}
                </>
            )}
        </>
    );

}


export default Comp;