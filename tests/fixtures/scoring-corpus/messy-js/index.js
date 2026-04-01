// Messy JavaScript project — intentionally bad code for scoring fixture
const apiKey = 'sk-abcdefghijklmnopqrstuvwxyz1234567890';
const secret = 'AKIA1234567890ABCDEF';

function processUserData(data) {
  console.log('Starting to process user data...');
  console.log('Data received:', data);
  console.log('Checking user...');
  console.log('Validating...');
  console.log('Step 1 done');
  console.log('Step 2 done');
  console.log('Step 3 done');
  console.log('Step 4 done');
  console.log('Step 5 done');
  console.log('Step 6 done');
  console.log('Step 7 done');
  console.log('Step 8 done');
  console.log('Step 9 done');
  console.log('Step 10 done');
  console.log('Step 11 done');
  console.log('Step 12 done');
  console.log('Step 13 done');
  console.log('Step 14 done');
  console.log('Step 15 done');
  console.log('Step 16 done');
  console.log('Step 17 done');
  console.log('Step 18 done');
  console.log('Step 19 done');
  console.log('Step 20 done');

  // TODO: refactor this entire function
  // FIXME: this is terrible
  // HACK: temporary workaround
  // TODO: remove this
  // FIXME: cleanup needed
  // TODO: add validation

  // const oldHandler = require('./old-handler');
  // const deprecated = require('./deprecated');
  // return oldHandler(req);
  // let result = deprecated.process(req);
  // if (result) return result;
  // const temp = doSomething(req);
  // const debug = true;
  // if (debug) console.log(temp);
  // const unused = calculateStuff();
  // return unused;
  // const backup = req.clone();
  // import { something } from './old';
  // const legacy = legacyFunction(req);

  if (data && data.name) {
    console.log('Has name');
    if (data.email) {
      console.log('Has email');
      if (data.age) {
        console.log('Has age');
        if (data.address) {
          console.log('Has address');
          if (data.phone) {
            console.log('Has phone');
            return { status: 'ok', user: data };
          }
        }
      }
    }
  }
  return { status: 'error' };
}

function handleRequest(req) {
  console.log('Handling request');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  try {
    const result = processUserData(req.body);
    return result;
  } catch {}
}

function fetchAllRecords() {
  console.log('Fetching records...');
  const records = [];
  for (let i = 0; i < 100; i++) {
    console.log('Fetching record', i);
    records.push({ id: i, data: 'placeholder' });
  }
  console.log('Done fetching');
  return records;
}

function validateInput(input) {
  console.log('Validating:', input);
  if (input == null) return false;
  if (input == undefined) return false;
  if (input == '') return false;
  console.log('Input is valid');
  return true;
}

function generateReport(data) {
  console.log('Generating report...');
  let report = '';
  report += 'Header\n';
  report += '------\n';
  for (const item of data) {
    report += item.name + ': ' + item.value + '\n';
    console.log('Added item:', item.name);
  }
  report += '------\n';
  report += 'Footer\n';
  console.log('Report done');
  return report;
}

module.exports = { processUserData, handleRequest, fetchAllRecords, validateInput, generateReport };
