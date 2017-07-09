"use latest";

/*
 * TODO:
 *  Order items by date, not by feed
 *  Style the frontend
 */

var app = new (require('express'))();
var wt = require('webtask-tools');
var request = require('request');
var events = require('events');
var moment = require('moment');

app.use(require('body-parser').text({type:"*/*"}));

const HEAD = "<html><head><title>JSON Feed Reader</title></head>";

const HTML = {
    "dbReadError": `${HEAD}<body>Server error occurred when reading DB. Try again later.</body></html>`,
    "noFeeds": `${HEAD}<body>There are no feeds in database. POST a JSON feed url to /add</body></html>`
};

function buildItemOutput(item) {
    var content = item.content_html ? item.content_html : item.content_text;
    return `
        <a href="${item.url}"><h2>${item.title}</h2></a>
        <p>${content}</p>
    `;
}

app.get('/', function(req, res) {
    req.webtaskContext.storage.get(function(error, data) {
        if (error) {
            console.log(error);
            res.writeHead(500, { "Content-type": "text/html" });
            res.end(HTML.dbReadError);
            return;
        }

        if (!data || !data.feeds) {
            res.writeHead(200, { "Content-type": "text/html" });
            res.end(HTML.noFeeds);
            return;
        }

        if (data.lastUpdated && moment(data.lastUpdated) > moment().subtract(30, 'minutes')) {
            console.log("Feeds are within the time limit. Not going to be re-downloaded.");
            res.writeHead(200, { "Content-type": "text/html; charset=utf-8" });
            res.end(`${HEAD}<body>${data.html}</body></html>`);
            return;
        }

        var output = "";
        var itemCount = 0;
        var feedCount = 0;
        var countCalls = function() {
            feedCount += 1;
            console.log(`Counting requests ${feedCount}`);
            if (feedCount == data.feeds.length) {
                res.writeHead(200, { "Content-type": "text/html; charset=utf-8" });
                res.end(`${HEAD}<body>${output}</body></html>`);
                data.lastUpdated = moment().toISOString();
                data.html = output;
                req.webtaskContext.storage.set(data, function(error) {
                    if (error) {
                        console.log(`Error writing to db: ${error}`);
                    }
                });
                console.log(`Finishing request. ${itemCount} items.`);
            }
        };
        var eventEmitter = new events.EventEmitter();
        eventEmitter.on('requestComplete', countCalls);

        var parseFeed = function(error, response, body) {
          if (!error) {
            var feed = JSON.parse(body);
            var first = true;
            for (let i = 0; i < feed.items.length; i++) {
              if (moment(feed.items[i].date_modified) > moment().subtract(24, 'hours')) {  // only add items modified in last 24 hours
                if (first) {
                  output += `<h1>${feed.title}</h1>`;
                  first = false;
                }
                output += buildItemOutput(feed.items[i]);
                itemCount += 1;
              }
            }
          }
          eventEmitter.emit('requestComplete');
        };

        for (var i = 0; i < data.feeds.length; i++) {
            console.log(`Getting feed from ${data.feeds[i]}`);
            request.get(data.feeds[i], parseFeed);
        }
    });
});

app.get('/list', function(req, res) {
    req.webtaskContext.storage.get(function(error, data) {
        if (error) {
            res.writeHead(500, { "Content-type": "application/json" });
            res.end(JSON.stringify({"message": `Server error when reading db: ${error}` }));
            return;
        }

        if (!data || !data.feeds) {
            res.writeHead(200, { "Content-type": "application/json" });
            res.end(JSON.stringify({"message": "No feeds are stored in database" }));
            return;
        }

        res.writeHead(200, { "Content-type": "application/json" });
        res.end(JSON.stringify(data.feeds));
    });
});


app.post('/add', function(req, res) {
    req.webtaskContext.storage.get(function(error, data) {
        if (error) {
            res.writeHead(500, { "Content-type": "application/json" });
            res.end(JSON.stringify({"message": `Server error when reading db: ${error}` }));
        }

        if (!data) {
            data = {};
            data.lastUpdated = null;
            data.feeds = [];
            data.html = "";
        }
        
        console.log(req.body);

        // probably should do some kind of validation here
        data.feeds.push(req.body);

        req.webtaskContext.storage.set(data, function(error) {
            if (error) {
                res.writeHead(500, { "Content-type": "application/json" });
                res.end(JSON.stringify({ "message": `Server error when writing db: ${error}` }));
                return;
            }

            res.writeHead(200, { "Content-type": "application/json" });
            res.end(JSON.stringify({ "message": `Feed ${req.body} added.`}));
        });
    });
});

app.post('/clear', function(req, res) {
    req.webtaskContext.storage.get(function(error, data) {
        if (error) {
            res.writeHead(500, { "Content-type": "application/json" });
            res.end(JSON.stringify({ "message": `Server error when reading db: ${error}` }));
        }

        data.lastUpdated = null;
        data.feeds = [];
        data.html = "";

        req.webtaskContext.storage.set(data, function(error) {
            if (error) {
                res.writeHead(500, { "Content-type": "application/json" });
                res.end(JSON.stringify({ "message": `Server error when writing db: ${error}` }));
                return;
            }

            res.writeHead(200, { "Content-type": "application/json" });
            res.end(JSON.stringify({ "message": "Feeds cleared from db" }));
        });
    });
});

module.exports = wt.fromExpress(app);
