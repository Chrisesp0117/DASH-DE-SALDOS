const { google } = require('googleapis');

async function getSheets(){

const auth = new google.auth.GoogleAuth({
keyFile: 'credentials.json',
scopes: [
'https://www.googleapis.com/auth/spreadsheets'
]
});

return google.sheets({
version: 'v4',
auth
});

}

module.exports = {
getSheets
};