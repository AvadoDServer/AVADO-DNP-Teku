import Validators from "./Validators";
import { SettingsType } from "./Types";
import { RestApi } from "./RestApi";
import { DappManagerHelper } from "./DappManagerHelper";

interface Props {
    restApi: RestApi| undefined | null
    keyManagerAPI: RestApi| undefined
    settings: SettingsType| undefined
    dappManagerHelper: DappManagerHelper | null
}

const Comp = ({ restApi, keyManagerAPI, settings, dappManagerHelper }: Props) => {
    return (
        <>
            {restApi && keyManagerAPI && settings && dappManagerHelper ? (<Validators
                settings={settings}
                restAPI={restApi}
                keyManagerAPI={keyManagerAPI}
                dappManagerHelper={dappManagerHelper}
            />)
                : <p>Loading...</p>}
        </>
    )
}

export default Comp;
