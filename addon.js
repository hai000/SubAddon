const { addonBuilder,serveHTTP} = require("stremio-addon-sdk")
const apikey = require("./api");
const languages = require("./languages.js");
const axios = require('axios');
const unzip = require('unzip-stream');
const fs = require('fs').promises;
const path = require('path')
const fsSynce = require('fs')
const subsourcebaseurl = "https://subsource.net"
var express = require("express")
let subcounts = [];
let timecodes = [];
let texts = [];
let translatedSubtitle = [];




// Docs: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md
const manifest = {
	"id": "community.SubAddon",
	"version": "0.0.1",
	"name": "SubAddon",
	"configurable": true,
	"behaviorHints": {
	  "configurable": true,
	  "configurationRequired": true,
	},
	"config": [
		{
			"key": "translateto",
			"title": "Translate to",
			"type": "select",
			"required": true,
			"options": languages.getAllValues(),
		  },
		{
			"key": "apikey",
			"title": "RapidAPI Microsoft Translate API Key",
			"type": "text",
			"required": true,
		  },
	],
	"catalogs": [],
	"resources": ["subtitles"],
	"types": [
		"movie",
		"series"
	],
	"description": "Auto sub vi"
}

const builder = new addonBuilder(manifest)
builder.defineSubtitlesHandler(async function (args) {
	const { id, config } = args;
	const oldisocode = languages.getKeyFromValue(config.translateto);
	let iso692 = languages.getnewisocode(oldisocode);
	if (iso692 === undefined) {
		iso692 = oldisocode;
	  }
	imdbid = getIMDBID(id)
	let fileName = await checkHaveSub(oldisocode,imdbid);
	const {type, season = null, episode = null } = parseId(id);
	if(!(fileName)) {
		const apikeyremaining = await apikey.checkapikey(config.apikey);
		if(config.apikey != undefined&& apikeyremaining!== false){
			if(imdbid !== null){// if imdbid is not null
				const subs = await foundSubtitles(type, imdbid,season,episode,iso692);
				// console.log("subs:" + subs)
				if(subs!=null&&subs.length>0){// if not found subtitles with your language
					if (
						(await checkAndTranslatingAPI(
							subs,
							imdbid,
							season,
							episode,
							oldisocode,
							config.apikey,
							apikeyremaining
						))

					) {
						let subtitles = [];
						const subtitle = {
							id: `Information`,
							url: `https://stremioaddon.sonsuzanime.com/subtitles/information.srt`,
							lang: iso692,
						};// sub info
						subtitles.push(subtitle);
						// call api to translate
						let translatedsubs = await fetchSubtitles(
							imdbid,
							season,
							episode,
							subs.length,
							type,
							iso692
						);
						translatedsubs.forEach((sub) => {
							subtitles.push(sub);
						});
						return Promise.resolve({ subtitles: subtitles });

					}else{
						return Promise.resolve({ subtitles: [] });
					}


				}else{
					return Promise.resolve({ subtitles: [] });
				}


			}else {
				console.log("Invalid id");
				return Promise.resolve({ subtitles: [] });
			}

		}else {
			console.log("Invalid apikey: ", config.apikey);
			let subtitles = [];
			const subtitle = {
				id: `Apikey error`,
				url: `https://stremioaddon.sonsuzanime.com/subtitles/apikeyerror.srt`,
				lang: iso692,
			};
			subtitles.push(subtitle);
			console.log("Invalid apikey apikeyerror returned: ", subtitles);
			return Promise.resolve({ subtitles: subtitles });
		}
	}else{
		let subtitles = [];
		let translatedsubs = await fetchSubtitles(imdbid,season,episode,1,type,iso692)
		translatedsubs.forEach((sub) => {
			subtitles.push(sub);
		});
		return Promise.resolve({ subtitles: subtitles });

	}

})
builder.constructor.name =  "AddonInterface"

async function checkAndTranslatingAPI(subtitles, imdbid, season = null, episode = null, oldisocode, apikey, apikeyremaining) {

	let filepaths = await downloadSubtitles(subtitles, imdbid, season, episode, oldisocode);
	let totalCharacterCount = 0;
	for (let index = 0; index < filepaths.length; index++) {
	  const originalSubtitleFilePath = filepaths[index];
	  try {
		const originalSubtitleContent = await fs.readFile(originalSubtitleFilePath, { encoding: 'utf-8' });
		const lines = originalSubtitleContent.split('\n');
		let iscount = true;
		let istimecode = false;
		let istext = false;
		let characters = [];
		let textcount = 0;
		let count = 0;
		for (let line of lines) {
			count++;
			if (line.trim() === '') {
			  iscount = true;
			  istimecode = false;
			  istext = false;
			  textcount = 0;
			} else if (iscount === true) {
			  iscount = false;
			  istimecode = true;
			} else if (istimecode === true) {
			  istimecode = false;
			  istext = true;
			} else if (istext === true) {
			  if (textcount === 0) {
				characters.push(line);
			  } else {
				characters[characters.length - 1] += " \n"+ line;
			  }
			  textcount++;
			}
		}
		characters.forEach(character => {
		  totalCharacterCount += character.length;
		});
	  } catch (error) {
		console.log("Check remaining api error", error.message);
	  }
	}
  if (apikeyremaining > totalCharacterCount||true) {
    main(imdbid, season, episode, oldisocode, apikey, filepaths);// call api to translate
    return true;
  } else {
    return false;
  }
}
async function downloadSubtitles(subtitles,imdbid,season = null,episode = null,oldisocode) {
	let uniqueTempFolder = null;
	if (season && episode){
		await fs.mkdir(`subtitles/${oldisocode}/${imdbid}/season${season}`, { recursive: true });
		uniqueTempFolder = `subtitles/${oldisocode}/${imdbid}/season${season}`;
	  } else{
		await fs.mkdir(`subtitles/${oldisocode}/${imdbid}`, { recursive: true });
		uniqueTempFolder = `subtitles/${oldisocode}/${imdbid}`;
	  }
	  let filepaths = [];
	  for (let i = 0; i < subtitles.length; i++) {
		const url = subtitles[i];
		try {
			const zipFilePath = 'subtitles/temp/file.zip';
			const extractPath = 'subtitles/origin';
		  let response = await axios.get(url, { responseType: 'arraybuffer' });
		  await fsSynce.writeFileSync(zipFilePath, response.data);
		  await fsSynce.createReadStream(zipFilePath).pipe(unzip.Extract({ path: extractPath }))
			console.log("giai nen sub success")
			let fileO =await fs.readdir(extractPath)
			const filePathO = `${extractPath}/${fileO[0]}`;
			response = await fs.readFile(filePathO, 'utf8');
		  // console.log(response)

		  let filePath = null;
		  if(episode)
		  {
			filePath = `${uniqueTempFolder}/${imdbid}-subtitle_${episode}-${i + 1}.srt`;
		  }
		  else{
			filePath = `${uniqueTempFolder}/${imdbid}-subtitle-${i + 1}.srt`;
		  }
		  console.log(filePath);
		  await fs.writeFile(filePath, response);
		  console.log(`Subtitles downloaded and saved: ${filePath}`);
		  filepaths.push(filePath);
		} catch (error) {
		  console.error(`Subtitle download error: ${error.message}`);
		}
	  }
	  return filepaths;
	  
}
async function foundSubtitles(type, imdbid,season,episode,iso692) {
	try {
		let nameLink = "";
		console.log(imdbid);
		const responseNameLink = await axios.post("https://api.subsource.net/api/searchMovie",{
			"query": imdbid
		})
		if (responseNameLink.data.success) {
			let dataMovie = responseNameLink.data.found;
			// console.log(dataMovie)
			nameLink = dataMovie[0].linkName;
		}
		console.log("Name link :"+nameLink)
		const response = await axios.post("https://api.subsource.net/api/getMovie",{
		  "langs":["Vietnamese"],
		  "movieName": nameLink
		})
		let subtitles = null;
		let lang = "english"
		if (response.data.success) {
		  if (response.data.subs.length>0){
			 subtitles = response.data.subs
				.filter(subtitle => subtitle.lang === 'Vietnamese')
				.map(subtitle => subtitle.subId);
			 if (subtitles.length>0) {// mac dinh la sai
				 console.log("co subtitles vn")
				 return null;
			 }
			 else{
				 subtitles = response.data.subs
					 .filter(subtitle => subtitle.lang === 'English')
					 .map(subtitle => subtitle.subId);

			 }
			if(subtitles.length === 0){
				lang = response.data.subs[0].lang
			  subtitles = [response.data.subs[0].subId]
			}
		  }else{
			  console.log("call api get movie failed")
			return null;
		  }
		}
		let subtitleFindID = subtitles[0];
		console.log(subtitleFindID);
		let responseSubMovie = await axios.post("https://api.subsource.net/api/getSub",{
			movie: nameLink,
			lang: lang,
			id: subtitleFindID
		})

		let dowloadToken = responseSubMovie.data.sub.downloadToken;

		return ["https://api.subsource.net/api/downloadSub/"+dowloadToken];
	  }catch (error){
		console.error('Subs url error:', error);
		return null;
	  }
}
async function main(imdbid, season = null, episode = null, oldisocode, apikey, filepaths) {
	try {
	  if (filepaths) {
		try {
		  await processsubtitles(filepaths, imdbid, season, episode, oldisocode, apikey);
		} catch (error) {
  
		  console.error("Error on processing subtitles:", error.message);
		}
	  } else {
		console.log('No subtitles found');
	  }
	} catch (error) {
	  console.error("Error on processing subtitles:", error.message);
	}
  }


async function fetchSubtitles(
	imdbid,
	season = null,
	episode = null,
	count,
	type,
	langcode
  ) {
	const subtitles = [];
	let oldisocode = languages.getoldisocode(langcode);
	if (oldisocode === undefined) {
	  oldisocode = langcode;
	}
	//http://127.0.0.1:55697/
	if (type === "movie") {
	  for (let i = 1; i <= count; i++) {
		const subtitle = {
		  id: `${imdbid}-subtitle-${i}`,
		  url: `https://subaddon.onrender.com/subtitles/${oldisocode}/${imdbid}/${imdbid}-translated-${i}.srt`,
		  lang: langcode,
		};
		subtitles.push(subtitle);
	  }
	} else {
	  for (let i = 1; i <= count; i++) {
		const subtitle = {

		  id: `${imdbid}-${season}-${episode}subtitle-${i}`,
		  url: `https://subaddon.onrender.com/subtitles/${oldisocode}/${imdbid}/season${season}/${imdbid}-translated-${episode}-${i}.srt`,
		  lang: langcode,
		};
		subtitles.push(subtitle);
	  }
	}
  
	return subtitles;
  }
  async function checkHaveSub(lang,imdb){
	let path = "subtitles/"+lang+"/"+imdb;
	try {
		let files = await fs.readdir(path);
		files = files.filter(file => file.includes("translated"))
		return files;
	}catch (error){
		console.log("chua sub")
		return null;
	}

  }
function getIMDBID(id){
	let imdbid = null;
  if (id !== null && id.startsWith("tt")) {
    const parts = id.split(":");
    if (parts.length >= 1) {
      imdbid = parts[0];
    } else {
      console.log("Invalid ID format.");
    }
  }
  return imdbid;
}
function parseId(id) {
	if (id.startsWith("tt")) {
	  const match = id.match(/tt(\d+):(\d+):(\d+)/);
	  if (match) {
		const [, , season, episode] = match;
		return {
		  type: "series",
		  season: Number(season),
		  episode: Number(episode),
		};
	  } else {
		return { type: "movie" };
	  }
	} else {
	  return { type: "unknown", season: 0, episode: 0 };
	}
  }
  async function processsubtitles(filepath, imdbid, season = null, episode = null,oldisocode,apikey) {
	for (let index = 0; index < filepath.length; index++) {
	  const originalSubtitleFilePath = filepath[index];
	  try {
		const originalSubtitleContent = await fs.readFile(originalSubtitleFilePath, { encoding: 'utf-8' });
		const lines = originalSubtitleContent.split('\n');
		const batchSize = 25;
		let subtitleBatch = [];
		let iscount = true;
		let istimecode = false;
		let istext = false;
		let textcount = 0;
		let count = 0;
		for (const line of lines) {
		  count++;
		  if (line.trim() === '') {
			iscount = true;
			istimecode = false;
			istext = false;
			textcount = 0;
			subtitleBatch.push(texts[texts.length - 1]);
			if (subtitleBatch.length === batchSize) {
			  try {
				await translatebatch(subtitleBatch, apikey,oldisocode);
				subtitleBatch = [];
			  } catch (error) {
				console.error("Translate batch error: ",error);
				subcounts = [];
				timecodes = [];
				texts = [];
				translatedSubtitle = [];
				subtitleBatch = [];
				return false;
			  }
			}
		  } else if (iscount === true) {
			subcounts.push(line);
			iscount = false;
			istimecode = true;
		  } else if (istimecode === true) {
			timecodes.push(line);
			istimecode = false;
			istext = true;
		  } else if (istext === true) {
			if (textcount === 0) {
			  texts.push(line);
			} else {
			  texts[texts.length - 1] += " \n"+ line;
			}
			textcount++;
		  }
		}
		if (subtitleBatch.length !== 0) {
		  try {
			subtitleBatch.push(texts[texts.length - 1]);
			await translatebatch(subtitleBatch, apikey,oldisocode);
			subtitleBatch = [];
		  } catch (error) {
			console.log("Subtitle batch error: ",error);
			subcounts = [];
			timecodes = [];
			texts = [];
			translatedSubtitle = [];
			subtitleBatch = [];
			return false;
		  }
		}
		try {
		  let currentCount = 0;
			currentCount = index + 1;
		  console.log("Current count: " + currentCount);
		  if (currentCount !== 0) {
			await savetranslatedsubs(currentCount, imdbid, season, episode, oldisocode);
			console.log("current count: " + currentCount);
		  }
		} catch (error) {
		  console.error("Translate batch error: ",error);
		}
  
		subcounts = [];
		timecodes = [];
		texts = [];
		translatedSubtitle = [];
		
	  } catch (error) {
		console.error('Error:', error.message);
	  }
	}
  }
  async function getNameMovie(imdb,name){
	let data = JSON.stringify({
		"query": imdb
	  });
	
	let config = {
		method: 'post',
		maxBodyLength: Infinity,
		url: 'https://api.subsource.net/api/searchMovie',
		headers: { 
		  'Content-Type': 'application/json', 
		},
		data : data
	  };
	  await axios.request(config)
	  .then((response) => {

		if (response.data.success) {
			let dataMovie = response.data.found;
			// console.log(dataMovie)
			name = dataMovie[0].linkName;
			console.log("name link "+name)
		}


	  })
	  .catch((error) => {
		  console.log(error)
	  });
	
  
  }
var respond = function (res, data) {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Headers', '*');
	res.setHeader('Content-Type', 'application/json');
	res.download(data, (err) => {
		if (err) {
			console.error('Error downloading file:', err);
			res.status(500).send('Error downloading file');
		}
	});
};
async function translatebatch(subtitleBatch, apikey,oldisocode) {
	let myObjectArray = subtitleBatch.map(text => ({ Text: text }));
	const res = await fetch("https://libretranslate.com/translate", {
		method: "POST",
		body: JSON.stringify({
			q: myObjectArray,
			source: "en",
			target: "vi"
		}),
		headers: { "Content-Type": "application/json" }
	});
	// const options = {
	// 	method: 'POST',
	// 	url: 'https://microsoft-translator-text.p.rapidapi.com/translate',
	// 	params: {
	// 		'to[0]': oldisocode,
	// 		'api-version': '3.0',
	// 		profanityAction: 'NoAction',
	// 		textType: 'plain'
	// 	},
	// 	headers: {
	// 		'Accept-Encoding': 'zlib',
	// 		'content-type': 'application/json',
	// 		'X-RapidAPI-Key': apikey,
	// 		'X-RapidAPI-Host': 'microsoft-translator-text.p.rapidapi.com'
	// 	},
	// 	data: JSON.stringify(myObjectArray)
	// };
	try {
		// const response = await axios.request(options);
		const response = res;
		console.log(res)
		response.data.forEach(entry => {
			const translatedText = entry.translations[0].text;
			translatedSubtitle.push(translatedText);
		});
		console.log("Batch translated");
	} catch (error)  {
		console.error("Batch translate error:", error.message);
		throw error;
	}
}
async function savetranslatedsubs(count, imdbid, season = null, episode = null,oldisocode) {
	let newSubtitleFilePath = null;
	let type = null;
	if (season && episode) {
		newSubtitleFilePath = `subtitles/${oldisocode}/${imdbid}/season${season}/${imdbid}-translated-${episode}-${count}.srt`;
		type = 'series';
	} else {
		newSubtitleFilePath = `subtitles/${oldisocode}/${imdbid}/${imdbid}-translated-${count}.srt`;
		type = 'movie';
	}
	const output = [];

	for (let i = 0; i < subcounts.length; i++) {
		output.push(subcounts[i]);
		output.push(timecodes[i]);
		output.push(translatedSubtitle[i]);
		output.push('');
	}

	try {
		await fs.writeFile(newSubtitleFilePath, output.join('\n'));
		console.log(`Subtitles translated and saved: ${newSubtitleFilePath}`);
	} catch (error) {
		console.error('Error writing to file:', error.message);
	}
}

module.exports = builder.getInterface()