import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
test('MCP stdio handshake, tool discovery and safe Demo result work through the actual SDK',async()=>{
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../mcp/server.js',import.meta.url))],env:{UNSIGNED_MCP_MODE:'demo'},stderr:'pipe'});
  const client=new Client({name:'unsigned-node-test',version:'1.0.0'});
  try{
    await client.connect(transport);
    const tools=await client.listTools();assert.deepEqual(tools.tools.map(t=>t.name).sort(),['draft_check_in_question','get_themes','schedule_check_in']);
    const response=await client.callTool({name:'get_themes',arguments:{}});assert.equal(response.isError,undefined);
    const data=JSON.parse(response.content[0].text);assert.equal(data.themes.length,2);
    data.themes.forEach(t=>assert.deepEqual(Object.keys(t).sort(),['band','summary','title']));
    const drafted=await client.callTool({name:'draft_check_in_question',arguments:{request:'What would help?'}});
    assert.equal(JSON.parse(drafted.content[0].text).inference,'none');
  }finally{await client.close();}
});
