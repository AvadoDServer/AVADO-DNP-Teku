const myArgs = process.argv.slice(2);

/*
Script to get a text file from an Avado package
Arguments:
1. packagename
2. path in container
3. local destination
*/

const packageName = myArgs[0]
const path = myArgs[1]
const destination = myArgs[2]

const url = "ws://wamp.my.ava.do:8080/ws";
const realm = "dappnode_admin";

const dataUriToBlob = (dataURI) => {
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
    var enc = new TextDecoder("utf-8");
    return enc.decode(ab)
}


const Wampy = require('wampy').Wampy;
w3cws = require('websocket').w3cwebsocket;
const ws = new Wampy(url, { realm: realm, ws: w3cws });

ws.call("copyFileFrom.dappmanager.dnp.dappnode.eth", {
    id: packageName,
    fromPath: path
}, {
    onSuccess: function (result) {
        const dataUri = JSON.parse(result.argsList[0]).result
        const data = dataUriToBlob(dataUri)

        fs = require('fs');
        fs.writeFile(destination, data, (e) => { if (e) console.error(e) })

        ws.disconnect();
    },
    onError: function (err) {
        console.log('RPC call failed!', err.error);
    }
})
