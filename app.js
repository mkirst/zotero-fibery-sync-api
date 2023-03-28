const express = require(`express`);
const path = require(`path`);
const logger = require(`morgan`);
const wrap = require(`express-async-wrap`);
const _ = require(`lodash`);
const uuid = require(`uuid-by-string`);
const got = require(`got`);
var parse = require('parse-link-header');
const fs = require('fs');
const Cite = require('citation-js')
const { processAuthor, processLiterature, processNote, processTag, populateJSONObj, handleBackoff, handleDeletes } = require('./utils');

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

    if (req.body.fields != null && req.body.fields.token != null) {
        response = await got(`https://api.zotero.org/keys/${req.body.fields.token}`);
        await handleBackoff(response.headers);
        body = JSON.parse(response.body);
        const user = body.username;
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
    if (account.auth == "token") {
        req_opts.headers["Zotero-API-Key"] = account.token;
    }
    
    if (_.isEmpty(account.libraryid)) {
        throw new Error(`Library ID must be specified`);
    }

    if (requestedType != `literature` && requestedType != `author` && requestedType != `venue` && requestedType != `tag` && requestedType != `note`) { 
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

    let url = `https://api.zotero.org/${prefix}/${libraryid}/items/top?limit=100&`;
    if (requestedType == "tag") {
        url = `https://api.zotero.org/${prefix}/${libraryid}/items/tags`;
    } else if (requestedType == "note") {
        url = `https://api.zotero.org/${prefix}/${libraryid}/items?itemType=note&`;
    }

    let items = [];

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
        json_obj.note = action.args.note;
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
        return res.json(result_json);        
    }
    return res.json({"message":"invalid action"});

}));

app.use(function (req, res, next) {
    const error = new Error(`Not found`);
    error.status = 404;
    next(error);
});

app.use(function (err, req, res, next) {
    res.status(err.status || 500);
    console.log(err);
    res.json({message: err.message, code: err.status || 500});
});

module.exports = app;
