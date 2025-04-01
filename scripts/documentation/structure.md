# Documentation JSON Structure

This document describes the structure of the JSON file used for documenting functions, commands, and features in the `useq` system. The JSON file is an array of objects, where each object represents a single function or command. Below is a detailed breakdown of the structure:

## Top-Level Structure
The JSON file is an array of objects:
```json
[
  { ... },
  { ... },
  ...
]
```
Each object in the array represents a single documented item.

## Object Fields
Each object contains the following fields:

### 1. `name` (string)
- **Description**: The name of the function or command.
- **Example**: `"+"`, `"define"`, `"useq-reboot"`

### 2. `aliases` (array of strings)
- **Description**: Alternative names or aliases for the function. If no aliases exist, this is an empty array.
- **Example**: `[]`, `["useq-memory-load"]`

### 3. `description` (string)
- **Description**: A detailed explanation of what the function does. It may include examples or additional notes.
- **Example**: `"Returns the sum of all its arguments, which are expected to evaluate to numbers."`

### 4. `parameters` (array of objects)
- **Description**: A list of parameters that the function accepts. Each parameter is represented as an object with the following fields:
  - `name` (string): The name of the parameter.
  - `description` (string): A description of the parameter's purpose.
  - `range` (string): The expected data type or range of values for the parameter. This field may be empty for some parameters.
  - `optional` (boolean, optional): Indicates whether the parameter is optional. Defaults to `false` if not specified.
  - `default` (any, optional): The default value of the parameter, if it is optional.
- **Example**:
  ```json
  [
    {
      "name": "value1",
      "description": "The first value to compare",
      "range": "any"
    },
    {
      "name": "pulseWidth",
      "description": "(optional) Width of the gates",
      "range": ">0 and <1",
      "optional": true,
      "default": 0.5
    }
  ]
  ```

### 5. `examples` (array of strings)
- **Description**: A list of usage examples for the function. Each example is a string. If no examples exist, this is an empty array.
- **Example**:
  ```json
  [
    "(+ 1 2 3) ;; => 6",
    "(+ 10 20) ;; => 30"
  ]
  ```

### 6. `category` (string)
- **Description**: The category to which the function belongs. Categories group related functions together.
- **Example**: `"modulisp"`, `"timing"`, `"system"`

### 7. `tags` (array of strings)
- **Description**: A list of tags that describe the function's purpose or usage. Tags are used for filtering or searching.
- **Example**: `["functional programming", "maths"]`

## Notable Exceptions and Abnormalities
1. **Empty Fields**:
   - Some fields, such as `aliases`, `examples`, or `parameters`, may be empty arrays (`[]`) or empty strings (`""`).
   - Example:
     ```json
     {
       "name": "useq-reboot",
       "aliases": [],
       "description": "Reboots the module.",
       "parameters": [],
       "examples": [],
       "category": "system",
       "tags": ["system"]
     }
     ```

2. **Inconsistent `range` Field**:
   - The `range` field in `parameters` is sometimes left empty (`""`) or contains vague descriptions like `"any"`.
   - Example:
     ```json
     {
       "name": "[numbers]",
       "description": "Parameter 1 of function +",
       "range": ""
     }
     ```

3. **Multi-Value Names**:
   - Some functions have names that include placeholders or patterns, such as `"a[1/2/3/...]"` or `"d[1/2/3/...]"`. These indicate that the function can be used with multiple variations.
   - Example:
     ```json
     {
       "name": "a[1/2/3/...]",
       "description": "Specify a function to calculate the value of analog output 1/2/3/etc.",
       ...
     }
     ```

4. **Embedded Examples in Descriptions**:
   - Some descriptions include examples directly within the text, rather than in the `examples` field.
   - Example:
     ```json
     {
       "name": "define",
       "description": "Creates a new **signal** definition... These definitions are accessible from anywhere in the code, unless they are shadowed by a local binding with higher precedence (e.g. when inside a `let` expression body).",
       ...
     }
     ```

5. **Optional Parameters**:
   - Some functions have optional parameters, which are indicated in the `parameters` field using the `optional` property. If a default value exists, it is specified in the `default` property.
   - Example:
     ```json
     {
       "name": "gates",
       "parameters": [
         {
           "name": "pulseWidth",
           "description": "The pulse width of the gates",
           "range": "0-1",
           "optional": true,
           "default": 0.5
         }
       ],
       ...
     }
     ```

6. **Special Characters in Names**:
   - Some function names include special characters, such as `"+"`, `"!="`, or `"%"`. These are valid names but may require special handling in scripts.
   - Example:
     ```json
     {
       "name": "+",
       "description": "Returns the sum of all its arguments...",
       ...
     }
     ```

7. **Aliases Field with Synonyms**:
   - The `aliases` field sometimes contains alternative names for the function. For example, `"useq-memory-restore"` has an alias `"useq-memory-load"`.
   - Example:
     ```json
     {
       "name": "useq-memory-restore",
       "aliases": ["useq-memory-load"],
       ...
     }
     ```

## Summary
The JSON documentation file is well-structured but includes some irregularities, such as empty fields, inconsistent `range` values, and embedded examples in descriptions. Scripts manipulating this file should account for these exceptions to ensure robust handling of the data.
