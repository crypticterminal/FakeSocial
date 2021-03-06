const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const readLine = require('readline');
const chalk = require('chalk');
const morgan = require('morgan');
const didyoumean = require('didyoumean');

const driver = require('./database/driver');
const schemaUtils = require('./database/schemaUtils');
const dashboard = require('./dashboard/dashboard');

let config;
try {
    config = require('../config');
} catch (err) {
    config = {databaseUrl: '', port: '', mode: '', dis_dashboard: false, debug: false};
}

const app = exports.app = express();
let specificMode = process.env.mode || config.mode || null;
const serviceDir = path.join(__dirname, 'services');
exports.databaseUrl = process.env.dburl || config.databaseUrl || null;
exports.usingDatabase = exports.databaseUrl && exports.databaseUrl.length > 10;
exports.dis_dashboard = process.env.dis_dashboard || config.dis_dashboard || false;
exports.debugMode = process.env.debug || config.debug || false;

const availableServices = [];
const availableServiceNames = [];

const notification = chalk.green(`[!]`);
const noteError = chalk.red(`[!]`);

if (!exports.usingDatabase) console.info(`${noteError} ${chalk.red(`No database url specified... Only outputting to console!`)}`);
if (exports.debugMode) console.info(`${notification} Debug mode enabled.. Showing all ${chalk.green(200)} requests on console!`);
else {
    driver.connect();
    console.info(`${notification} Successfully connected to database at: ${chalk.green(exports.databaseUrl)}`);
}

try {
    let files = fs.readdirSync(serviceDir);
    files.forEach(file => {
        if (!file.startsWith('_') && file.endsWith('.js')) {
            let service = require(path.join(serviceDir, file));

            if (typeof service.info !== 'undefined' &&
                typeof service.info.name !== 'undefined' &&
                typeof service.info.views !== 'undefined' &&
                typeof service.info.static !== 'undefined' &&
                typeof service.execute !== 'undefined') {

                availableServices[service.info.name] = service;
                availableServiceNames.push(service.info.name);
            } else {
                console.error(`${noteError} Error loading module, ${file}, module is corrupt`);
            }
        }
    });
} catch (err) {
    console.error(`${noteError} Error while setting up available modes, Error: ${err.stack}`);
}

try {
    if (!specificMode || !availableServiceNames.includes(specificMode.toLowerCase())) {
        if (availableServiceNames.length === 1) {
            console.info(`${notification} Only one service available, running ${chalk.red(availableServiceNames[0])}`);
            specificMode = availableServiceNames[0];
            initWeb();
            return;
        }

        let prompt = readLine.createInterface(process.stdin, process.stdout);
        prompt.setPrompt(`${chalk.green(`[${chalk.red('==')}]`)} Please select one of the services to run: (${chalk.blue(availableServiceNames.join(', '))}): `);
        prompt.prompt();
        prompt.on('line', line => {
            if (availableServiceNames.includes(line.toLowerCase())) {
                specificMode = line;
                prompt.close();

                initWeb();
            } else {
                // User didyoumean to get closer results
                prompt.prompt();
            }
        })
    }
} catch (err) {
    console.error(`${noteError} Error enabling specific mode, Error: ${err.stack}`);
}

function initWeb() {
    try {
        app.use(bodyParser.json());
        app.use(morgan(':method :url :status - :response-time ms', {
            skip: (req, res) => {
                return exports.debugMode === false || res.statusCode !== 200;
            }
        }));
        app.use(bodyParser.urlencoded({extended: true}));
        app.use(express.static('Web'));
        app.set('view engine', 'ejs');

        if (!exports.dis_dashboard && exports.databaseUrl) dashboard.init(app);

        if (!availableServices[specificMode]) return console.error(`Error running mode ${specificMode}, Exiting..`);
        app.use('/', express.static(`${__dirname}/services/${availableServices[specificMode].info.static}`));
        app.set('views', [`${__dirname}/dashboard/views/`, `${__dirname}/services/${availableServices[specificMode].info.views}`]);

        try {
            availableServices[specificMode].execute(app, schemaUtils);
        } catch (err) {
            console.error(`${noteError} Error handing service ${exports.info.name}, Error: ${err.stack}`);
        }
    } catch (err) {
        console.error(`${noteError} Error during web init, Error: ${err.stack}`);
    }

// Set up final server
    try {
        const httpServer = http.createServer(app);
        let port = process.env.PORT || config.port || 80;
        httpServer.listen(port, err => {
            if (err) {
                console.error(`${noteError} FAILED TO OPEN WEB SERVER, ERROR: ${err.stack}`);
                return;
            }
            console.info(`${notification} Successfully started ${chalk.red(specificMode)} server... listening on port: ${chalk.green(port)}`);
        })
    } catch (err) {
        console.error(`${noteError} Error starting up server, Error: ${err.stack}`)
    }
}
