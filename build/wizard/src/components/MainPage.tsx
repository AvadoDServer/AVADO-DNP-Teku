import Validators from "./Validators";
import { SettingsType } from "./Types";
import { RestApi } from "./RestApi";

interface Props {
    restApi: RestApi| undefined | null
    keyManagerAPI: RestApi| undefined
    settings: SettingsType| undefined
}

const Comp = ({ restApi, keyManagerAPI, settings }: Props) => {
    return (
        <>
            {restApi && keyManagerAPI && settings ? (<Validators
                settings={settings}
                restAPI={restApi}
                keyManagerAPI={keyManagerAPI}
            />)
                : <p>Loading...</p>}
        </>
    )
}

export default Comp;
