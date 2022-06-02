const autobahn = require('autobahn-browser')

export class WampConnection {
    sessionPromise: Promise<any>;
    packageName: string;

    constructor(packageName:string) {
        this.packageName = packageName;
        this.sessionPromise = new Promise((resolve, reject) => {
            const url = "ws://wamp.my.ava.do:8080/ws";
            const realm = "dappnode_admin";
            const connection = new autobahn.Connection({ url, realm });
            connection.onopen = (session: any) => {
                console.debug("CONNECTED to \nurl: " + url + " \nrealm: " + realm);
                resolve(session);
            };
            // connection closed, lost or unable to connect
            connection.onclose = (reason: any, details: any) => {
                console.error("CONNECTION_CLOSE", { reason, details });
            };
            connection.open();
        })
    }

    public async getSession() {
        const session =  await this.sessionPromise
        return session
    }

    dataUriToBlob(dataURI: string) {
        if (!dataURI || typeof dataURI !== "string")
            throw Error("dataUri must be a string");

        // Credit: https://stackoverflow.com/questions/12168909/blob-from-dataurl
        // convert base64 to raw binary data held in a string
        // doesn't handle URLEncoded DataURIs - see SO answer #6850276 for code that does this
        const byteString = atob(dataURI.split(",")[1]);
        // separate out the mime component
        // dataURI = data:application/zip;base64,UEsDBBQAAAg...
        const mimeString = dataURI
            .split(",")[0]
            .split(":")[1]
            .split(";")[0];
        // write the bytes of the string to an ArrayBuffer
        const ab = new ArrayBuffer(byteString.length);
        // create a view into the buffer
        const ia = new Uint8Array(ab);
        // set the bytes of the buffer to the correct values
        for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
        }
        // write the ArrayBuffer to a blob, and you're done
        const blob = new Blob([ab], { type: mimeString });
        return blob;
    }

    //FixMe: rename getFileContentFromContainer
    public getFileContent (pathInContainer: string) {
        const fetchData = async () => {
            const wampSession =  await this.sessionPromise
            const res = JSON.parse(await wampSession.call("copyFileFrom.dappmanager.dnp.dappnode.eth", [],
                {
                    id: this.packageName,
                    fromPath: pathInContainer
                }
            ));
            console.log("result",res)
            if (res.success !== true) return;
            const dataUri = res.result;
            if (!dataUri) return;
            const data = await this.dataUriToBlob(dataUri).text();

            return data
        }
        return fetchData();
    }

    public writeFileToContainer (fileName:string, pathInContainer:string, data:string) {
        const pushData = async () => {
            const wampSession =  await this.sessionPromise
            const base64Data = Buffer.from(data).toString("base64");
            const dataUri = `data:application/json";base64,${base64Data}`
            const res = JSON.parse(await wampSession.call("copyFileTo.dappmanager.dnp.dappnode.eth", [],
                {
                    id: this.packageName,
                    dataUri: dataUri,
                    filename: fileName,
                    toPath: pathInContainer
                }));
            console.log("write result", res)
            if (res.success !== true) return;
    
            return res
        }
        return pushData();

    }
}