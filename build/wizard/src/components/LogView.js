import React from "react";

const packageName = "rocketpool.avado.dnp.dappnode.eth";


const LogView = ({ wampSession }) => {
    const [log, setLog] = React.useState("Loading...");

    React.useEffect(() => {
        getLog();
    }, [wampSession]) // eslint-disable-line

    async function getLog() {
        if (wampSession) {
            const x = await wampSession.call("logPackage.dappmanager.dnp.dappnode.eth", [],
                {
                    id: packageName,
                    options: { tail: 20 }
                }
            );
            const res = JSON.parse(x);
            setLog(res.result);
        }
    }

    return (
        <div>
            <h2 className="title is-3 has-text-white">Latest log entries</h2>
            <div className="container">
                <pre className="transcript">
                    {log}
                </pre>
            </div>
            <button className="button" onClick={getLog}>Refresh log</button>
        </div>
    );
};

export default LogView