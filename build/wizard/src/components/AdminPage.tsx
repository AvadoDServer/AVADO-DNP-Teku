import { RestApi } from "./shared/RestApi";
import { DappManagerHelper } from "./shared/DappManagerHelper";
import Logs from "./shared/Logs";
import { useEffect, useState } from "react";

interface Props {
    restApi: RestApi | undefined | null
    dappManagerHelper: DappManagerHelper
}

const Comp = ({ restApi, dappManagerHelper }: Props) => {


    const stop = async () => {restApi?.post("/service/stop", {}, (res) => { 
        console.log("Stop")
    }, (err) => { })}
    const start = async () => {restApi?.post("/service/start", {}, (res) => { }, (err) => { })}
    const restart = async () => {restApi?.post("/service/restart", {}, (res) => { }, (err) => { })}

    const [status, setStatus] = useState<any[]>();

    useEffect(() => {
        const interval = setInterval(() => {
            restApi?.get("/service/status", (res) => {
                setStatus(res.data);
            }, (err) => {
                setStatus([]);
            });
        }, 5 * 1000); // 5 seconds refresh
        return () => clearInterval(interval);
    }, []);

    return (
        <>
            <h2 className="title is-2 has-text-white">Debug</h2>
            <div className="content">
                <ul>
                    {restApi && (
                        <li>
                            <a href={`${restApi?.baseUrl}/swagger-ui`} target="_blank" rel="noopener noreferrer">Swagger RPC UI</a>

                        </li>
                    )}
                    {dappManagerHelper && (
                        <li>
                            <a href={`http://my.ava.do/#/Packages/${dappManagerHelper.packageName}/detail`} target="_blank" rel="noopener noreferrer">Avado package management page</a>

                        </li>
                    )}
                </ul>
                {status && (
                    <ul>
                        {status.map((program) => 
                            <li>
                                <b>{program.name}</b>: {program.statename}
                            </li>
                        )}                        
                    </ul>
                )}
                {
                    <div className="field">
                        <button className="button" onClick={() => stop()}>Stop</button>
                        <button className="button" onClick={() => start()}>Start</button>
                        <button className="button" onClick={() => restart()}>Restart</button>
                    </div>
                }

                {dappManagerHelper && (<Logs dappManagerHelper={dappManagerHelper} />)}
            </div>

        </>
    )
}

export default Comp;
