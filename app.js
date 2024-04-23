const express = require(`express`);
const path = require(`path`);
const logger = require(`morgan`);
const wrap = require(`express-async-wrap`);
const _ = require(`lodash`);
const uuid = require(`uuid-by-string`);
const got = require(`got`);
var parse = require('parse-link-header');
const fs = require('fs');
const Cite = require('citation-js');
const showdown  = require('showdown');
const { processCollection, processAuthor, generateBibKey, processLiterature, processNote, processTag, populateJSONObj, handleBackoff, handleDeletes } = require('./utils');

const app = express();
app.use(logger(`dev`));
app.use(express.json());
app.use(express.urlencoded({extended: false}));

// Uncomment to print out contents of requests
// app.use(function (req, res, next) {
//     console.log("Res: ", res);
//     next();
// });

app.get(`/logo`, (req, res) => res.sendFile(path.resolve(__dirname, `logo.svg`)));

const appConfig = require(`./config.app.json`);
app.get(`/`, (req, res) => res.json(appConfig));

app.post(`/validate`, wrap(async (req, res) => {

    const req_opts = {headers:{}};
    let prefix = "users";
    if ("librarytype" in req.body.fields && req.body.fields.librarytype) {
        prefix = "groups"; 
    }

    if (req.body.fields != null && req.body.fields.token != null) {
        try {
            const response = await got(`https://api.zotero.org/keys/${req.body.fields.token}`);
            await handleBackoff(response.headers);
            req_opts.headers["Zotero-API-Key"] = req.body.fields.token;
    
            body = JSON.parse(response.body);
            const user = body.username;

            try {
                await got(`https://api.zotero.org/${prefix}/${req.body.fields.libraryid}/items?limit=25`, req_opts);
            } catch(err) {
                res.status(err.response.statusCode);
                if (err.response.statusCode == 500) {
                    return res.json({message:"Invalid library ID (should be a sequence of numbers)"});
                }    
                if (err.response.statusCode == 404) {
                    if (prefix == "groups") {
                        return res.json({message:"Invalid library ID (checkbox indicates that this is supposed to be a group library; find its ID by clicking on the groups tab in Zotero)"});
                    }
                    return res.json({message:"Invalid library ID (checkbox indicates that this is an individual library; the ID should be the userID given on https://www.zotero.org/settings/keys) (hint: it should be a sequence of numbers)"});
                }
                if (err.response.statusCode == 403) {
                    return res.json({message: "The given API token does not have access to the specified library"});
                }
            }
            if (user) {
                if (req.body.fields.connectionname) {
                    return res.json({
                        name: `${req.body.fields.connectionname} (username: ${user}) (${req.body.id})`,
                    });                    
                }
                return res.json({
                    name: `${user} library ${req.body.fields.libraryid} (${req.body.id})`,
                });
            }    
        } catch(err) {
            res.status(500);
            if (err.response.statusCode == 404) {
                return res.json({message:"Invalid Zotero API key provided"});
            }
        }

    }

    try {
        await got(`https://api.zotero.org/${prefix}/${req.body.fields.libraryid}/items?limit=25`);
    } catch (err) {
        res.status(err.response.statusCode);
        if (err.response.statusCode == 500) {
            return res.json({"message":"Invalid library ID (should be a sequence of numbers)"});
        }
        if (err.response.statusCode == 404) {
            if (prefix == "groups") {
                return res.json({"message":"Invalid library ID (checkbox indicates that this is supposed to be a group library; find its ID by clicking on the groups tab in Zotero)"});
            }
            return res.json({"message":"Invalid library ID (checkbox indicates that this is an individual library; the ID should be the userID given on https://www.zotero.org/settings/keys) (hint: it should be a sequence of numbers)"});
        }
        if (err.response.statusCode == 403) {
            return res.json({"message": "The specified library is not publicly accessible. Change library or use token authentication."});
        }    
    }


    if (req.body.fields.connectionname) {
        return res.json({
            name: `${req.body.fields.connectionname}`,
        });                    
    }

    return res.json({name: `${req.body.id} library ${req.body.fields.libraryid}`});
}));

const syncConfig = require(`./config.sync.json`);
app.post(`/api/v1/synchronizer/config`, (req, res) => res.json(syncConfig));

const schema = require(`./schema.json`);

app.post(`/api/v1/synchronizer/schema`, (req, res) => res.json(schema));

app.post(`/api/v1/synchronizer/data`, wrap(async (req, res) => {
    let {requestedType, pagination, account, lastSynchronizedAt} = req.body;
    const req_opts = {headers:{}};

    console.log(req.body);
    
    if (account.auth == "token") {
        req_opts.headers["Zotero-API-Key"] = account.token;
    }
    
    if (_.isEmpty(account.libraryid)) {
        throw new Error(`Library ID must be specified`);
    }

    if (requestedType != `literature` && requestedType != `author` && requestedType != `venue` && requestedType != `tag` && requestedType != `note` && requestedType != `collection`) { 
        throw new Error(`Only literature and author databases can be synchronized`);
    }

    const {libraryid} = account;
    const {librarytype} = account;
    let prefix = "users";
    if (librarytype) {
        prefix = "groups"; 
    } 
    const filename = libraryid + "." + account["_id"] + "." + requestedType + ".txt";

    let synchronizationType = "delta";

    let url = `https://api.zotero.org/${prefix}/${libraryid}/items/top?sort=creator&direction=asc&limit=100&`;
    if (requestedType == "tag") {
        url = `https://api.zotero.org/${prefix}/${libraryid}/items/tags`;
    } else if (requestedType == "note") {
        url = `https://api.zotero.org/${prefix}/${libraryid}/items?itemType=note&`;
    } else if (requestedType == "collection") {
        url = `https://api.zotero.org/${prefix}/${libraryid}/collections?`;
    }

    let items = [];
    let bibKeys = [];

    if (pagination != null && pagination["link"] != null) {
        console.log("using pagination link ", pagination["link"], "for type", requestedType);
        url = pagination["link"];
        synchronizationType = pagination["synchronizationType"];
    } else if (pagination == null) {
        pagination = {};
        if (lastSynchronizedAt == null) {
            synchronizationType = "full";
        } else {
            try {
                const version = fs.readFileSync(path.resolve(__dirname, filename), 'utf8');
                console.log(version);
                url += `?since=${version}`;
                const deleted = await got(`https://api.zotero.org/${prefix}/${libraryid}/deleted?since=${version}`, req_opts);
                handleDeletes(JSON.parse(deleted.body), requestedType);
                req_opts.headers["If-Unmodified-Since-Version"] = version;                
            } catch (err) {
                console.log("File does not exist");
                synchronizationType = "full";
            }
        }
    }


    let response = await (got(url, req_opts));
    if (response.status == 304) {
        pagination["hasNext"] = false;
        console.log("No updates");
        return res.json({items, pagination, synchronizationType});        
    }
    if (await handleBackoff(response.headers) > 0) {
        return res.json({message: "Rate limits exceeded", tryLater:true});
    }
        
    if (requestedType == `literature`) {
        for (const item of JSON.parse(response.body)) {
            const data = item.data;
            if (!("key" in item)) {
                console.log("Item has no key:", item);
                continue;                
            }

            if (data.itemType == "note") {
                // Don't sync standalone notes!
                continue;
            }

            // Create unique bib key as name
            let bibKey = generateBibKey(item.meta, bibKeys);
            bibKeys.push(bibKey);
            data.name = bibKey + ' (' + item.key + ')';

            // Find collections
            if ("collections" in data) {
                for (c of data.collections) {                    
                    data.collectionId.push(c.id);
                }        
            }

            data.bibtex = (await got(`https://api.zotero.org/${prefix}/${libraryid}/items/${item.key}?format=bibtex`, req_opts)).body;
            try {
                data.id = uuid(JSON.stringify(item.key));
            } catch(error) {
                console.log(error, item, requestedType, url, item.key, JSON.stringify(item.key));
                continue;
            }
            processLiterature(data, item);
            items.push(data);
        };
    } else if (requestedType == `author`) {

        for (const item of JSON.parse(response.body)) {
            
            if (!("creators" in item.data)) {
                continue;
            }
            for (a of item.data.creators) {
                if (a.creatorType != "author") {
                    continue;
                }
                processAuthor(a);
                a.__syncAction = "SET";
                items.push(a);
            }

        }
        // Remove duplicates
        items = [...new Map(items.map((m) => [m.id, m])).values()];
    } else if (requestedType == `venue`) {
        items = {};

        for (const item of JSON.parse(response.body)) {
            const data = item.data;
            let venuename;
            let venuetype;
            if ("publicationTitle" in data) {
                venuename = data.publicationTitle;
                venuetype = "journal";
            } else if ("conferenceName" in data && data.conferenceName != "") {
                venuename = data.conferenceName;
                venuetype = "conference";
            } else if ("proceedingsTitle" in data) {
                venuename = data.proceedingsTitle;
                venuetype = "conference";                
            } else if ("bookTitle" in data) {
                venuename = data.bookTitle;
                venuetype = "book";
            } else {
                venuename = data.itemType;
                venuetype = data.itemType;
            }

            if (!(uuid(JSON.stringify(venuename)) in items)) {
                items[uuid(JSON.stringify(venuename))] = {};
                venue = items[uuid(JSON.stringify(venuename))]

                venue.id = uuid(JSON.stringify(venuename));
                venue.name = venuename;
                venue.type = venuetype;
                venue.__syncAction = "SET";
            }
        }

    } else if (requestedType == `tag`) {

        for (const item of JSON.parse(response.body)) {

            processTag(item);
            items.push(item);

        }
    } else if (requestedType == `collection`) {

        for (const item of JSON.parse(response.body)) {

            processCollection(item);
            items.push(item);

        }
    } else if (requestedType == `note`) {

        for (const item of JSON.parse(response.body)) {
            const data = item.data;

            if (!("key" in data)) {
                console.log("data has no key:", data);
                continue;                
            }
            processNote(data, item);
            items.push(data);
        }
    }

    let parsed = parse(response.headers.link);

    pagination["hasNext"] = parsed["next"] != null;
    if (pagination["hasNext"]) {
        pagination["nextPageConfig"] =  {
            "link": parsed["next"]["url"],
            "synchronizationType": synchronizationType
            };
    }  else {
        // We've finished syncing this version
        // Let's record its number
        console.log("Finished with this type, writing last modified verison", response.headers["last-modified-version"])
        fs.writeFile(path.resolve(__dirname, filename), response.headers["last-modified-version"], err => {
            if (err) {
                console.error(err);
            }
            // file written successfully
            });
    }

    return res.json({items, pagination, synchronizationType});
    
}));

app.post(`/api/v1/automations/action/execute`, wrap(async (req, res) => {

    let {action, account} = req.body;

    let req_opts = {headers: {
        "Zotero-API-Key" : account.token
     }
    };

    let prefix = "users";
    if (account.librarytype) {
        prefix = "groups";
    }

    if (action.action == "add-new-paper") {
        let a = new Cite(action.args.doi);
        let output = JSON.parse(a.format('data'));
        
        let url = "https://api.zotero.org/items/new?itemType=";
        
        if (output[0].type == "article-journal") {
            url += "journalArticle";
        } else if (output[0].type == "paper-conference") {
            url += "conferencePaper";
        } else {
            url += "report";
        }
        
        response = await (got(url, req_opts));
        if (await handleBackoff(response.headers) > 0) {
            return res.json({message: "Rate limits exceeded", tryLater:true});
        }    
        json_obj = JSON.parse(response.body);
        populateJSONObj(json_obj, output);
        const new_url = `https://api.zotero.org/${prefix}/${account.libraryid}/items/`;

        const result = await got(new_url, {
            method: 'POST',
            headers: {
                'Zotero-API-Key': account.token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify([json_obj])
        });
        json_resp = JSON.parse(result.body);
        return res.json(json_resp);

    } else if (action.action == "add-new-note") {

        const url = "https://api.zotero.org/items/new?itemType=note";        
        const response = await (got(url, req_opts));
        if (await handleBackoff(response.headers) > 0) {
            return res.json({message: "Rate limits exceeded", tryLater:true});
        }
        const json_obj = JSON.parse(response.body);
        // console.log(action.args.note);
        var converter = new showdown.Converter();
        json_obj.note =  converter.makeHtml(action.args.note);
        json_obj.parentItem = action.args.parent;
        const new_url = `https://api.zotero.org/${prefix}/${account.libraryid}/items/`;
        const result = await got(new_url, {
            method: "POST",
            headers: {
                'Zotero-API-Key': account.token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify([json_obj])
        });
        const result_json =  JSON.parse(result.body);
        // console.log(result_json);
        if ("0" in result_json.failed) {
            return res.json(result_json.failed["0"]);                    
        }
        return res.json(result_json);        
    }
    return res.json({message:"invalid action"});

}));

app.use(function (req, res, next) {
    const error = new Error(`Not found`);
    error.status = 404;
    next(error);
});

app.use(function (err, req, res, next) {
    res.status(err.status || 500);
    console.log(err, req.body);
    res.json({message: err.message, code: err.status || 500});
});

module.exports = app;
