const {MET} = require('bing-translate-api')
const tunnel = require('tunnel');
async function fnTranslate(texts,from,to) {
    let res =await MET.translate(texts,from,to)
    // const res=await translate.translate(texts,from,to)
    let translated = []
    res.forEach(data => {translated.push(data.translations[0].text)})
    return translated;
}
fnTranslate(['hello','what the fuck'], 'en','vi')
module.exports = fnTranslate;

