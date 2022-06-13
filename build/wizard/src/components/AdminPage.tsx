import { RestApi } from "./RestApi";
import { DappManagerHelper } from "./DappManagerHelper";
import { SupervisorCtl } from "./SupervisorCtl";
import Logs from "./Logs";

interface Props {
    restApi: RestApi | undefined | null
    dappManagerHelper: DappManagerHelper
    supervisorCtl: SupervisorCtl | undefined
}

const Comp = ({ restApi, dappManagerHelper, supervisorCtl }: Props) => {


    const toggleTeku = (enable: boolean) => { // eslint-disable-line
        const method = enable ? 'supervisor.startProcess' : 'supervisor.stopProcess'
        supervisorCtl?.callMethod(method, ["teku"]);
    }
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
                {supervisorCtl && <div className="field">
                    <button className="button" onClick={() => toggleTeku(true)}>Start Teku</button>
                    <button className="button" onClick={() => toggleTeku(false)}>Stop Teku</button>
                </div>
                }

                {dappManagerHelper && (<Logs dappManagerHelper={dappManagerHelper} />)}
            </div>

        </>
    )
}

export default Comp;
