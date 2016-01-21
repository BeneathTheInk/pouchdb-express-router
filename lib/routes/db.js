'use strict';

var jsonParser = require('body-parser').json({limit: '1mb'});
var extend = require('extend');

var utils = require('../utils.js');

module.exports = function(app, db) {

  // // Create a database
  // app.put('/:db', jsonParser, function (req, res, next) {
  //   var name = encodeURIComponent(req.params.db);
  //   new PouchDB(name, function (err, db) {
  //     if (err) return res.status(412).send(err);
  //     res.status(201).send({ok: true});
  //   });
  // });
  //
  // // Delete a database
  // app.delete('/:db', function (req, res, next) {
  //   var name = encodeURIComponent(req.params.db);
  //   new PouchDB(name).destroy(function (err, info) {
  //     if (err) return res.status(500).send(err);
  //     res.status(200).send({ok: true });
  //   });
  // });

  // ['/:db/*','/:db'].forEach(function (route) {
  //   app.all(route, function (req, res, next) {
  //     var name = encodeURIComponent(req.params.db);
  //     new PouchDB(name, function (err, db) {
  //       if (err) return res.status(412).send(err);
  //       req.db = db;
  //       next();
  //     });
  //   });
  // });

  // Get database information
  app.get('/', function (req, res, next) {
    db.info(function (err, info) {
      if (err) return res.status(500).send(err);
      res.status(200).send(info);
    });
  });

  // Bulk docs operations
  app.post('/_bulk_docs', jsonParser, function (req, res, next) {
    var opts = 'new_edits' in req.body
      ? { new_edits: req.body.new_edits } : {};

    if (Array.isArray(req.body)) {
      return res.status(400).send({
        error: "bad_request",
        reason: "Request body must be a JSON object"
      });
    }

    db.bulkDocs(req.body, opts, function (err, response) {
      if (err) return utils.sendError(res, err);
      res.status(201).send(response);
    });
  });

  // All docs operations
  app.all('/_all_docs', jsonParser, function (req, res, next) {
    if (req.method !== 'GET' && req.method !== 'POST') return next();

    // Check that the request body, if present, is an object.
    if (!!req.body && (typeof req.body !== 'object' || Array.isArray(req.body))) {
      return res.status(400).send({
        reason: "Something wrong with the request",
        error: 'bad_request'
      });
    }

    var opts = extend({}, req.body, req.query);
    db.allDocs(opts, function (err, response) {
      if (err) return res.status(500).send(err);
      res.status(200).send(response);
    });
  });

  // Monitor database changes
  function changes(req, res, next) {
    req.query.query_params = JSON.parse(JSON.stringify(req.query));

    if (req.body && req.body.doc_ids) {
      req.query.doc_ids = req.body.doc_ids;
    }

    if (req.query.feed === 'continuous' || req.query.feed === 'longpoll') {
      var heartbeatInterval;
      var timeout;
      var heartbeat = (typeof req.query.heartbeat === 'number')
        ? req.query.heartbeat : 6000;
      var written = false;
      heartbeatInterval = setInterval(function () {
        written = true;
        res.write('\n');
      }, heartbeat);

      var cleanup = function () {
        if (timeout) {
          clearTimeout(timeout);
        }
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }
      };

      if (req.query.feed === 'continuous') {
        req.query.live = req.query.continuous = true;
        db.changes(req.query).on('change', function (change) {
          written = true;
          res.write(JSON.stringify(change) + '\n');
        }).on('error', function (err) {
          if (!written) {
            utils.sendError(res, err);
          } else {
            res.end();
          }
          cleanup();
        });
      } else { // longpoll
        // first check if there are >0. if so, return them immediately
        req.query.live = req.query.continuous = false;
        if (req.query.timeout) {
          timeout = setTimeout(function() {
            written = true;
            res.write(JSON.stringify({
              results: [],
              last_seq: req.query.since
            }) + '\n');
            res.end();
            cleanup();
          }, req.query.timeout);
        }
        db.changes(req.query).on('complete', function (complete) {
          if (!complete.results) {
            // canceled, ignore
            cleanup();
          } else if (complete.results.length) {
            written = true;
            res.write(JSON.stringify(complete) + '\n');
            res.end();
            cleanup();
          } else { // do the longpolling
            req.query.live = req.query.continuous = true;

            var changes = db.changes(req.query).on('change', function (change) {
              if (written) {
                return;
              }
              written = true;
              res.write(JSON.stringify({
                results: [change],
                last_seq: change.seq
              }) + '\n');
              res.end();
              changes.cancel();
              cleanup();
            }).on('error', function (err) {
              if (!written) {
                utils.sendError(res, err);
              }
              cleanup();
            });
          }
        }).on('error', function (err) {
          if (!written) {
            utils.sendError(res, err);
          }
          cleanup();
        });
      }
    } else { // straight shot, not continuous
      db.changes(req.query).then(function (response) {
        utils.sendJSON(res, 200, response);
      }).catch(function (err) {
        utils.sendError(res, err);
      });
    }
  }

  app.get('/_changes', changes);
  app.post('/_changes', jsonParser, changes);

    // DB Compaction
  app.post('/_compact', jsonParser, function (req, res, next) {
    db.compact(req.query, function (err, response) {
      if (err) return utils.sendError(res, err);
      res.status(200).send({ok: true});
    });
  });

  // Revs Diff
  app.post('/_revs_diff', jsonParser, function (req, res, next) {
    db.revsDiff(req.body || {}, req.query, function (err, diffs) {
      if (err) return utils.sendError(res, err);
      res.status(200).send(diffs);
    });
  });


  // Query a document view
  function queryView(req, res, next) {
    var query = req.params.id + '/' + req.params.view;
    db.query(query, req.query, function (err, response) {
      if (err) return res.status(500).send(err);
      res.status(200).send(response);
    });
  }

  app.get('/_design/:id/_view/:view', queryView);
  app.post('/_design/:id/_view/:view', jsonParser, function (req, res, next) {
    extend(req.query, { keys: req.body.keys });
    next();
  }, queryView);

  // Temp Views
  app.post('/_temp_view', jsonParser, function (req, res, next) {
    if (req.body.map) req.body.map = (new Function('return ' + req.body.map))();
    req.query.conflicts = true;
    db.query(req.body, req.query, function (err, response) {
      if (err) return utils.sendError(res, err);
      utils.sendJSON(res, 200, response);
    });
  });


};
