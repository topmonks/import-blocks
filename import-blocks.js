const Promise = require('bluebird');
const Progress = require('progress');
const program = require('commander');
const Web3 = require('web3');
const Influx = require('influx');

program
  .option('-t, --transactions', 'import transactions')
  .option('-s, --start <block>', 'import from block number')
  .option('-e, --end <block>', 'import to block number')
  .option('-u, --url <server>', 'node url')
  .option('-x, --extension <ext>', 'block data extension, supported: rsk,eth')
  .option('-d, --db <url>', 'influx db url')
  .option('-o, --stdout', 'outputs to stdout instead of db')
  .option('-c, --concurrency <requests>', 'batch of blocks imported concurrently', 100);
program.parse(process.argv);

const nodeUrl = program.url || "http://192.168.1.26:5444";
const dbUrl = program.db || "http://192.168.1.26:8086/rsk";
const concurrency = Number(program.concurrency);

const web3 = new Web3(new Web3.providers.HttpProvider(nodeUrl), null, {});
const db = new Influx.InfluxDB(dbUrl);
let {start, end, transactions, extension, stdout} = program;
let bar;

const range = (start, end) => {
  if (start === null || end === null || start > end) {
    throw new Error("both start and end block has to be specified as args");
  }
  let nums = [];
  for (let i = end; i >= start; i--) nums.push(i);
  return nums;
};

const blockMeasurement = block => {
  const {number, miner, timestamp, gasUsed, gasLimit, size, hash, extraData} = block;
  const measurement = {
    measurement: 'block',
    tags: {miner},
    timestamp: timestamp*1000000000,
    fields: {
      number, gasUsed, gasLimit, size, hash, extraData,
      transactions: block.transactions.length,
      minerAddress: miner,
      uncles: block.uncles.length,
      difficulty: Number(web3.utils.fromWei(block.difficulty, 'ether')),
      totalDifficulty: Number(web3.utils.fromWei(block.totalDifficulty, 'mether'))
    }
  };
  if (extension === 'rsk') {
    measurement.fields = {
      ...measurement.fields,
      paidFees: Number(web3.utils.fromWei(block.paidFees, 'gwei')),
      minimumGasPrice: Number(web3.utils.fromWei(block.minimumGasPrice, 'gwei'))
    };
  }
  return measurement;
};

const transactionMeasurement = (tx, block) => {
  const {from, transactionIndex, gas, hash, blockNumber, input} = tx;
  const to = tx.to || "newContract";
  return {
    measurement: 'transaction',
    tags: {from, to, transactionIndex},
    timestamp: block.timestamp*1000000000,
    fields: {
      hash, gas, blockNumber, input,
      fromAddress: from,
      toAddress: to,
      value: Number(web3.utils.fromWei(tx.value, 'ether')),
      gasPrice: Number(web3.utils.fromWei(tx.gasPrice, 'gwei'))
    }
  }

};

async function stats() {
  await db.query(`CREATE DATABASE ${db._options.database} WITH SHARD DURATION 30d NAME myrp`);
  const first = await web3.eth.getBlock(0);
  if (!start || !end) {
    start = start || await db.query('SELECT max("number") FROM "block"').then(([res]) => res && res.max) + 1 || 0;
    end = end || first.number;
  }
  if (!extension) {
    if (first.paidFees !== undefined && first.minimumGasPrice !== undefined) extension = 'rsk';
  }
  const blocks = range(start, end);
  if (!stdout) {
    console.log(`importing ${extension ? extension : 'eth'} blocks ${transactions ? 'and transactions ' : ''}${start} -> ${end}`);
    bar = new Progress('[:bar] :current/:total :ratebps :etas',{total: blocks.length});
  }
  await Promise.map(
    blocks,
    num => web3.eth.getBlock(num)
      .then(async block => {
        let points = [blockMeasurement(block)];
        if (transactions) {
          await Promise.map(block.transactions, async txHash => {
            const tx = await web3.eth.getTransaction(txHash);
            points.push(transactionMeasurement(tx, block));
          }, {concurrency});
        }
        return points;
      }).then(async points => {
        if (stdout) {
          console.log(points);
        } else {
          await db.writePoints(points);
          bar.tick();
        }
      }),
    {concurrency});
}

stats().catch(e => {
  console.log(e);
  process.exit(1);
});