import React from "react";

const SyncStatusTag = ({ progress, label }) => { // progress: a number between 0 and 1
    return (
        <span className={"tag" + (progress === 1 ? " is-success" : " is-warning")}>
            {(label?`${label} `:"") + parseFloat(progress * 100).toFixed(2) + "% synced"}
        </span>
    );
};

export default SyncStatusTag


