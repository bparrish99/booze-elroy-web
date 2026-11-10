"""Export the game's data tables straight out of the original Lua into JSON (no hand transcription).
RETIRED: the Lua is over and assets/data.json is now also written by the maze editor (tools/maze-editor);
re-running this would drop the editor's mazes (booze5, ...). Kept for the record."""
import json, sys
from lupa.luajit21 import LuaRuntime

import os
SRC = os.environ.get("BOOZE_SRC") or sys.exit("set BOOZE_SRC to the original booze-elroy folder")
OUT = sys.argv[1] if len(sys.argv) > 1 else "assets/data.json"

lua = LuaRuntime(unpack_returned_tuples=True)
lua.execute(r'''
SRCDIR = "%s"
package.path = "%s/?.lua;" .. package.path
local stub = setmetatable({}, {__index=function(t,k) return function() end end})
love = setmetatable({}, {__index=function(t,k) return stub end})
g = { config = {ghostCount=4,mazepack="pac",difficulty=0,movement=0}, particles = {}, fadeLength = function() return 240 end }
''' % (SRC, SRC))

js = lua.eval(r'''(function()
  local fruits = require("fruits")
  local maps = require("maps")
  local maze = require("maze")
  local levels = require("levels")
  local animations = require("animations")
  local constants = require("constants")

  local fruitNames = {}
  for name, f in pairs(fruits) do fruitNames[f] = name end

  local forceObject = { [levels.normal] = true, [levels.hard] = true, [levels.plus] = true }

  local ser
  local function esc(s)
    return '"' .. s:gsub('[%c"\\]', function(c)
      if c == '"' then return '\\"' elseif c == '\\' then return '\\\\' end
      return string.format("\\u%04x", c:byte())
    end) .. '"'
  end
  ser = function(v)
    local t = type(v)
    if t == "number" then
      if v == math.huge then return "1e999" end
      return string.format("%.17g", v)
    elseif t == "boolean" then return tostring(v)
    elseif t == "string" then return esc(v)
    elseif t == "table" then
      if fruitNames[v] then return '{"$fruit":' .. esc(fruitNames[v]) .. '}' end
      local count, n = 0, #v
      for _ in pairs(v) do count = count + 1 end
      if n == count and n > 0 and not forceObject[v] then
        local parts = {}
        for i = 1, n do parts[i] = ser(v[i]) end
        return "[" .. table.concat(parts, ",") .. "]"
      end
      local keys = {}
      for k, val in pairs(v) do
        if type(val) ~= "function" then keys[#keys+1] = k end
      end
      table.sort(keys, function(a, b)
        if type(a) == type(b) then return a < b end
        return tostring(a) < tostring(b)
      end)
      local parts = {}
      for _, k in ipairs(keys) do parts[#parts+1] = esc(tostring(k)) .. ":" .. ser(v[k]) end
      return "{" .. table.concat(parts, ",") .. "}"
    end
    return "null"
  end

  local mazeNames = {}
  do
    local f = io.open(SRCDIR .. "/maze.lua"):read("*a")
    for name in f:gmatch("\ninstances%.([%w]+) = Maze%(") do mazeNames[#mazeNames+1] = name end
  end
  local mazes = {}
  for _, name in ipairs(mazeNames) do mazes[name] = maze.getMaze(name) end

  -- the fruits table itself must carry real fields (everywhere else fruits are exported as references)
  local fruitData = {}
  for name, f in pairs(fruits) do fruitData[name] = { sheet = f.sheet, quad = f.quad, score = f.score } end

  local plusMap = {}
  for from, to in pairs(levels.plusModeFruitMap) do plusMap[fruitNames[from]] = fruitNames[to] end

  return ser({
    fruits = fruitData,
    mazes = mazes,
    mazeNames = mazeNames,
    maxColors = maze.maxColors,
    levels = { normal = levels.normal, hard = levels.hard, plus = levels.plus },
    plusModeFruitMap = plusMap,
    animations = animations,
    constants = constants,
  })
end)()''')

data = json.loads(js)
# the maze instances carry their map under "map"; keep it as is
with open(OUT, "w") as f:
    json.dump(data, f, separators=(",", ":"))
print("wrote", OUT, len(json.dumps(data)) // 1024, "KB")
print("levels:", {k: len(v) for k, v in data["levels"].items()}, "| mazes:", list(data["mazes"].keys()))
print("sample maze keys:", sorted(data["mazes"]["pac"].keys()))
