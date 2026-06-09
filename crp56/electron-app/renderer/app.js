const output = document.getElementById('output');

function show(data)
{
    output.textContent = JSON.stringify(data, null, 2);
}

document.getElementById('btn-ping').addEventListener('click', async () =>
{
    show(await window.crp56.ping());
});

document.getElementById('btn-version').addEventListener('click', async () =>
{
    show(await window.crp56.version());
});

document.getElementById('btn-encrypt').addEventListener('click', async () =>
{
    const passphrase = document.getElementById('passphrase').value;
    const plainText = document.getElementById('plain-text').value;
    const result = await window.crp56.encryptText(passphrase, plainText);
    show(result);
    if (result.ok) {
        document.getElementById('plain-text').value = result.result;
    }
});

document.getElementById('btn-decrypt').addEventListener('click', async () =>
{
    const passphrase = document.getElementById('passphrase').value;
    const cipherTextBase64 = document.getElementById('plain-text').value;
    const result = await window.crp56.decryptText(passphrase, cipherTextBase64);
    show(result);
    if (result.ok) {
        document.getElementById('plain-text').value = result.result;
    }
});