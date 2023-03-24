const express = require(`express`);
const path = require(`path`);
const logger = require(`morgan`);
const wrap = require(`express-async-wrap`);
const _ = require(`lodash`);
const uuid = require(`uuid-by-string`);
const got = require(`got`);
var parse = require('parse-link-header');
const fs = require('fs');
var glob = require("glob")
const Cite = require('citation-js')
const fetch = (url) => import('node-fetch').then(({default: fetch}) => fetch(url));


const app = express();
app.use(logger(`dev`));
app.use(express.json());
app.use(express.urlencoded({extended: false}));


/**
 * Determine whether the given `input` is iterable.
 *
 * @returns {Boolean}
 */
function isIterable(input) {  
    if (input === null || input === undefined) {
      return false
    }
  
    return typeof input[Symbol.iterator] === 'function'
  }

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
        body = JSON.parse(response.body);
        const user = body.username;
         if (user) {
            return res.json({
                name: `${user} (${req.body.id})`,
            });
        }
    }


    return res.json({name: req.body.id});
}));

app.get(`/api/v1/synchronizer/clearcache`, (req, res) => {
    glob("**/*.literature.txt", function (er, files) {
        for (const file of files) {
            fs.unlinkSync(file);
        }
    });
    glob("**/*.author.txt", function (er, files) {
        for (const file of files) {
            fs.unlinkSync(file);
        }
    });

});

const syncConfig = require(`./config.sync.json`);
app.post(`/api/v1/synchronizer/config`, (req, res) => res.json(syncConfig));

const schema = require(`./schema.json`);
app.post(`/api/v1/synchronizer/schema`, (req, res) => res.json(schema));

app.post(`/api/v1/synchronizer/data`, wrap(async (req, res) => {
    var {requestedType, filter, pagination, account} = req.body;
    var req_opts = {headers: {
                                "Zotero-API-Key" : account.token
                             }
                    };
    
    if (_.isEmpty(filter.libraryid)) {
        throw new Error(`Library ID must be specified`);
    }

    if (requestedType != `literature` && requestedType != `author` && requestedType != `venue` && requestedType != `tag` && requestedType != `note`) { 
        throw new Error(`Only literature and author databases can be synchronized`);
    }

    const {libraryid} = filter;
    const {librarytype} = filter;
    var prefix = "users";
    if (librarytype) {
        prefix = "groups"; 
    } 
    const filename = libraryid + "." + account["owner"] + "." + requestedType + ".txt";
    // console.log(filename, req.body);
    var synchronizationType = "delta";

    var url = `https://api.zotero.org/${prefix}/${libraryid}/items/top?limit=100&`;
    if (requestedType == "tag") {
        url = `https://api.zotero.org/${prefix}/${libraryid}/items/tags`;
    } else if (requestedType == "note") {
        url = `https://api.zotero.org/${prefix}/${libraryid}/items?itemType=note&`;
    }

    if (pagination != null && pagination["link"] != null) {
        url = pagination["link"];
        synchronizationType = pagination["synchronizationType"];
    } else if (pagination == null) {
        pagination = {};
        try {
            const version = fs.readFileSync(path.resolve(__dirname, filename), 'utf8');
            console.log(version);
            url += `?since=${version}`;
          } catch (err) {
            // console.error(err);
            console.log("File does not exist");
            synchronizationType = "full";
          }
    }

    var items = [];
    response = await (got(url, req_opts));
    // console.log(response.body);
        
    if (requestedType == `literature`) {
        for (item of JSON.parse(response.body)) {
            data = item.data;
            if (!("key" in item)) {
                console.log("Item has no key:", item);
                continue;                
            }
            if (typeof JSON.stringify(item.key) !== `string`) {
                console.log("Item key not a string:", item);
                continue;
            }
            if (typeof JSON.stringify(item.key) === undefined) {
                console.log("Item key undefined:", item);
                continue;
            }
            data.bibtex = (await got(`https://api.zotero.org/${prefix}/${libraryid}/items/${item.key}?format=bibtex`, req_opts)).body;
            data.id = uuid(JSON.stringify(item.key));
            data.name = data.title;
            data.link = item.links.alternate.href;
            data.key = item.key;
            data.authorId = [];
            if ("creators" in data) {
                for (a of data.creators) {
                    if (a.creatorType != "author") {
                        continue;
                    }
                    if (a.firstName === undefined) {
                        a.firstName = "NA";
                    } else {
                        a.firstName = a.firstName.split(" ")[0];
                    }
                    a.name = a.firstName + " " + a.lastName;
                    a.id = uuid(JSON.stringify(a.name));
                    data.authorId.push(a.id);
                }
            }
            if ("publicationTitle" in data) {
                data.venueId = uuid(JSON.stringify(data.publicationTitle));
            } else if ("conferenceName" in data && data.conferenceName != "") {
                data.venueId = uuid(JSON.stringify(data.conferenceName));
            } else if ("proceedingsTitle" in data) {
                data.venueId = uuid(JSON.stringify(data.proceedingsTitle));
            } else if ("bookTitle" in data) {
                data.venueId = uuid(JSON.stringify(data.bookTitle));
            } else {
                data.venueId = uuid(JSON.stringify(data.itemType));
            }

            data.tagId = [];
            for (a of data.tags) {
                a.id = uuid(JSON.stringify(a.tag));
                data.tagId.push(a.id);
            }
            data.__syncAction = "SET";
            items.push(data);
        };
    } else if (requestedType == `author`) {
        // items = {};

        for (item of JSON.parse(response.body)) {
            
            if (!("creators" in item.data)) {
                continue;
            }
            for (a of item.data.creators) {
                if (a.creatorType != "author") {
                    continue;
                }
                if (a.firstName === undefined) {
                    a.firstName = "NA";
                } else {
                    a.firstName = a.firstName.split(" ")[0];
                }
                a.name = a.firstName + " " + a.lastName;
                a.id = uuid(JSON.stringify(a.name));
                a.__syncAction = "SET";
                items.push(a);
            }

        }
        // Remove duplicates
        items = [...new Map(items.map((m) => [m.id, m])).values()];
    } else if (requestedType == `venue`) {
        items = {};

        for (item of JSON.parse(response.body)) {
            data = item.data;
            var venuename;
            var venuetype;
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
                // venue.literatureId = [uuid(JSON.stringify(data.key))];
            } //else {
                // venue.literatureId.push(uuid(JSON.stringify(data.key)));
           // }

            // items.push(venue);

        }
        // Remove duplicates
        // items = [...new Map(items.map((m) => [m.id, m])).values()];
    } else if (requestedType == `tag`) {

        for (item of JSON.parse(response.body)) {

            item.name = item.tag;

            item.id = uuid(JSON.stringify(item.name));
            item.type = item.meta.type;
            item.link = item.links.alternate.href;

            item.__syncAction = "SET";
            items.push(item);

        }
    } else if (requestedType == `note`) {

        for (item of JSON.parse(response.body)) {
            data = item.data;

            if (!("key" in data)) {
                console.log("data has no key:", data);
                continue;                
            }
            if (typeof JSON.stringify(data.key) !== "string") {
                console.log("data key not a string:", data);
                continue;
            }
            if (typeof JSON.stringify(data.key) === undefined) {
                console.log("data key undefined:", data);
                continue;
            }

            data.name = data.key;
            data.id = uuid(JSON.stringify(data.key));
            data.literatureId = uuid(JSON.stringify(data.parentItem));
            data.link = item.links.alternate.href;
            data.creator = item.meta.createdByUser.name;
            data.__syncAction = "SET";
            items.push(data);
        }
    }

    var parsed = parse(response.headers.link);

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
    // console.log({items, pagination, synchronizationType});
    return res.json({items, pagination, synchronizationType});
    
}));

app.post(`/api/v1/automations/action/execute`, wrap(async (req, res) => {
    // console.log(req.body);
    var {action, account} = req.body;

    var req_opts = {headers: {
        "Zotero-API-Key" : account.token
     }
    };


    var prefix = "users";
    if (action.args.librarytype) {
        prefix = "groups";
    }

    if (action.action == "add-new-paper") {
        let a = new Cite(action.args.doi);
        let output = JSON.parse(a.format('data'));
        
        var url = "https://api.zotero.org/items/new?itemType=";
        
        if (output[0].type == "article-journal") {
            url += "journalArticle";
        } else if (output[0].type == "paper-conference") {
            url += "conferencePaper";
        } else {
            url += "report";
        }
        
        response = await (got(url, req_opts));
        // console.log(response);
        json_obj = JSON.parse(response.body);
        json_obj.title = output[0].title;
        json_obj.date = output[0].issued["date-parts"][0][0];

        if ("volume" in json_obj && "volume" in output[0]) {
            json_obj.volume = output[0].volume;
        }

        if ("url" in json_obj && "URL" in output[0]) {
            json_obj.url = output[0].URL;
        }

        if ("publisher" in json_obj && "publisher" in output[0]) {
            json_obj.publisher = output[0].publisher;
        }

        if ("abstractNote" in json_obj && "abstract" in output[0]) {
            json_obj.abstractNote = output[0].abstract;
        }

        if ("pages" in json_obj && "page" in output[0]) {
            json_obj.pages = output[0].page;
        }

        if ("issue" in json_obj && "issue" in output[0]) {
            json_obj.issue = output[0].issue;
        }

        if ("ISSN" in json_obj && "ISSN" in output[0]) {
            json_obj.ISSN = output[0].ISSN;
        }

        if ("ISBN" in json_obj && "ISBN" in output[0]) {
            json_obj.ISBN = output[0].ISBN;
        }

        var counter = 0;
        for (author of output[0].author) {
            new_author = JSON.parse(JSON.stringify(json_obj.creators[0]));
            new_author.firstName = author.given;
            new_author.lastName = author.family;
            if (counter > 1) {
                json_obj.creators.push(new_author);
            } else {
                json_obj.creators[0] = new_author;
            }

        }

        if (output[0].type == "article-journal") {
            json_obj.DOI = output[0].DOI;
            json_obj.publicationTitle = output[0]["container-title"];            
        } else if (output[0].type == "paper-conference") {
            json_obj.DOI = output[0].DOI;
            json_obj.conferenceName = output[0]["event-title"];
            json_obj.proceedingsTitle = output[0]["container-title"];
        } else {
            json_obj.extra = "DOI: " + output[0].DOI;
        }

        var new_url = `https://api.zotero.org/${prefix}/${action.args.libraryid}/items`;

        var result = await fetch(new_url, {
            method: 'post',
            headers: {
                'Zotero-API-Key': account.token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify([json_obj])
        });
        json_resp = await result.json();
        // console.log(json_resp);
        return res.json(json_resp);

    } else if (action.action == "add-new-note") {

        var url = "https://api.zotero.org/items/new?itemType=note";        
        response = await (got(url, req_opts));
        // console.log(response);
        json_obj = JSON.parse(response.body);
        json_obj.note = action.args.note;
        json_obj.parentItem = action.args.parent;
        var new_url = `https://api.zotero.org/${prefix}/${action.args.parent.libraryid}/items`;
        // console.log(json_obj);
        var result = await fetch(new_url, {
            method: 'post',
            headers: {
                'Zotero-API-Key': account.token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify([json_obj])
        });
        json_resp = await result.json();
        // console.log(json_resp);
        return res.json(json_resp);        
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
