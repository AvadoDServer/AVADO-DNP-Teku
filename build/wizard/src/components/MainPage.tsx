import Validators from "./shared/Validators";
import { SettingsType } from "./shared/Types";
import { RestApi } from "./shared/RestApi";
import { DappManagerHelper } from "./shared/DappManagerHelper";

interface Props {
    restApi: RestApi| undefined | null
    keyManagerAPI: RestApi| undefined| null
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
