const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const R = require('../assets/rules.js');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/data.js'),'utf8'), sandbox);
const students = JSON.parse(JSON.stringify(sandbox.window.REVIEW_ROSTER.students));
function validScores(offset = 0) {
  const slots = R.quotas(students.length).flatMap((count, i) => Array(count).fill(R.BANDS[i].min));
  return Object.fromEntries(students.map((s, i) => [s.id, slots[(i+offset)%slots.length]]));
}
test('真实点名册包含 67 位唯一学生，不发布完整学号', () => {
  assert.equal(students.length, 67);
  assert.equal(new Set(students.map(s => s.id)).size, 67);
  assert.equal(students[0].name, '刘骏');
  assert.equal(students[66].name, '谢弘博');
  assert.equal(students.some(s => 'studentNumber' in s || 'code' in s), false);
});
test('67 人配额为 13/20/20/14；余数相同优先较低分档', () => {
  assert.deepEqual(R.quotas(67), [13,20,20,14]);
  assert.deepEqual(R.quotas(10), [2,3,3,2]);
  assert.deepEqual(R.quotas(7), [1,2,2,2]);
  for(let n=1;n<=1000;n++) assert.equal(R.quotas(n).reduce((a,b)=>a+b,0), n);
});
test('含自评的完整评分可以通过；100 分归入 90–100 档', () => {
  const scores = validScores(); scores[students[0].id] = 100;
  assert.equal(R.validate(scores, students).ok, true);
  assert.equal(R.validate(scores, students).filled, 67);
});
test('缺少自己、名单外对象、字符串、小数、越界分数均不通过', () => {
  for(const badValue of [59,101,80.5,'80',null,NaN,Infinity]) {
    const scores = validScores(); scores[students[0].id] = badValue;
    assert.equal(R.validate(scores, students).ok, false);
  }
  const missing = validScores(); delete missing[students[0].id];
  assert.equal(R.validate(missing, students).ok, false);
  const extra = validScores(); extra.fake = 80;
  assert.equal(R.validate(extra, students).ok, false);
});
test('配额被绕过时不能提交', () => {
  const scores = validScores(); scores[students[66].id] = 90;
  assert.equal(R.validate(scores, students).ok, false);
  assert.equal(R.validate(Object.fromEntries(students.map(s=>[s.id,100])),students).ok,false);
});
test('只有 2 人提交时除以 2；未提交者同样能正常获得平均分', () => {
  const a = validScores(), b = validScores(25);
  const rows = R.summarize(students,[{rater_id:students[0].id,scores:a},{rater_id:students[1].id,scores:b}]);
  rows.forEach(s => {
    assert.equal(s.count,2);
    assert.equal(s.total,a[s.id]+b[s.id]);
    assert.equal(s.average,(a[s.id]+b[s.id])/2);
  });
  assert.equal(rows.filter(s=>s.submitted).length,2);
  assert.equal(rows[66].submitted,false);
  assert.equal(rows[0].average,(a[students[0].id]+b[students[0].id])/2);
});
test('无人提交时平均分为空，不是零；重复评分人不重复累计', () => {
  R.summarize(students,[]).forEach(s => { assert.equal(s.average,null); assert.equal(s.count,0); });
  const ballot={rater_id:students[0].id,scores:validScores()};
  assert.throws(()=>R.summarize(students,[ballot,ballot]),/重复/);
});
test('CSV 带 BOM、正确转义并防止公式注入', () => {
  const csv = R.csv(['姓名','分数'],[['=SUM(1,2)',90],['含"引号,姓名',80]]);
  assert.equal(csv.charCodeAt(0),0xFEFF);
  assert.ok(csv.includes('"\'=SUM(1,2)"'));
  assert.ok(csv.includes('"含""引号,姓名"'));
});
test('评价码容许空格、横线、小写输入',()=>assert.equal(R.normalizeCode('abcd-1234  efab-5678'),'ABCD1234EFAB5678'));
