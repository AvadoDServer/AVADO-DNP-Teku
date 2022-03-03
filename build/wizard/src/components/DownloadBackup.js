import React from "react";
import config from "../config";

const DownloadBackup = ({description}) => {

    const downloadBackup = () => {
        window.location.href = `${config.api.HTTP}/rocket-pool-backup.zip`;
    }

    return (
        <button className="button" onClick={downloadBackup}>{description || "Download Rocket Pool Data Backup"}</button>
    );

}


export default DownloadBackup;