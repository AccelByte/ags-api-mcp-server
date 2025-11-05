# Plan: Add Comprehensive Parameter Validation to `run-apis` Tool

## Overview
Currently, the `run-apis` tool only validates path parameters before making remote API calls. This plan adds validation for all required parameters (query, headers, request body, cookies) to catch errors earlier and avoid unnecessary network requests.

## Current State
- **Validated:** Path parameters only
- **Not Validated:** Query parameters, headers, request body fields, cookies
- **Impact:** Missing required parameters are only caught by the remote API server

## Implementation Tasks

### Task 1: Add Query Parameter Validation
**File:** `src/tools/openapi-tools.ts`

**Changes:**
- Create a `validateQueryParameters()` method
- Validate required query parameters are present before building the request
- Check against OpenAPI parameter definitions in the operation
- Throw descriptive errors for missing required query params

**Prompt for AI:**
```
Add query parameter validation to the run-apis tool in src/tools/openapi-tools.ts.

Requirements:
1. Create a private method `validateQueryParameters(operation: ApiOperation, queryParams?: Record<string, any>): void`
2. Check that all required query parameters (where parameter.in === 'query' && parameter.required === true) are present in the provided queryParams
3. Throw an error with format: "Missing required query parameter '{name}' for {operation.method} {operation.path}"
4. Call this method in runApi() before building the URL (around line 270, before the query params are added)
5. Follow the existing code style and patterns in the file
```

---

### Task 2: Add Header Parameter Validation
**File:** `src/tools/openapi-tools.ts`

**Changes:**
- Create a `validateHeaderParameters()` method
- Validate required headers are present before building the request
- Check against OpenAPI parameter definitions
- Throw descriptive errors for missing required headers

**Prompt for AI:**
```
Add header parameter validation to the run-apis tool in src/tools/openapi-tools.ts.

Requirements:
1. Create a private method `validateHeaderParameters(operation: ApiOperation, headers?: Record<string, any>): void`
2. Check that all required header parameters (where parameter.in === 'header' && parameter.required === true) are present in the provided headers
3. Throw an error with format: "Missing required header '{name}' for {operation.method} {operation.path}"
4. Call this method in runApi() before building headers (around line 291, before headers are processed)
5. Follow the existing code style and patterns in the file
```

---

### Task 3: Add Request Body Validation
**File:** `src/tools/openapi-tools.ts`

**Changes:**
- Create a `validateRequestBody()` method
- Validate required request body is present
- Validate required fields within the body against the schema
- Throw descriptive errors for missing required body or fields

**Prompt for AI:**
```
Add request body validation to the run-apis tool in src/tools/openapi-tools.ts.

Requirements:
1. Create a private method `validateRequestBody(operation: ApiOperation, body?: any): void`
2. Check if operation.requestBody?.required is true and body is missing, throw error: "Missing required request body for {operation.method} {operation.path}"
3. If body is provided and operation.requestBody?.schema exists, validate required fields:
   - Check operation.requestBody.schema.required array
   - Verify each required field exists in the body object
   - Throw error: "Missing required field '{fieldName}' in request body for {operation.method} {operation.path}"
4. Call this method in runApi() before setting config.data (around line 313, before body processing)
5. Follow the existing code style and patterns in the file
```

---

### Task 4: Add Cookie Parameter Validation
**File:** `src/tools/openapi-tools.ts`

**Changes:**
- Create a `validateCookieParameters()` method
- Validate required cookie parameters are present
- Check against OpenAPI parameter definitions
- Throw descriptive errors for missing required cookies

**Prompt for AI:**
```
Add cookie parameter validation to the run-apis tool in src/tools/openapi-tools.ts.

Requirements:
1. Create a private method `validateCookieParameters(operation: ApiOperation, cookies?: Record<string, any>): void`
2. Check that all required cookie parameters (where parameter.in === 'cookie' && parameter.required === true) are present in the provided cookies
3. Throw an error with format: "Missing required cookie '{name}' for {operation.method} {operation.path}"
4. Call this method in runApi() if cookies are supported (check if args.cookies exists in the arguments interface first)
5. Follow the existing code style and patterns in the file
```

---

### Task 5: Add Unit Tests for Query Parameter Validation
**File:** Create/update test file

**Changes:**
- Add test cases for validateQueryParameters
- Test missing required params, present required params, optional params

**Prompt for AI:**
```
Add unit tests for query parameter validation in the run-apis tool.

Requirements:
1. Find or create the appropriate test file for openapi-tools.ts
2. Add test cases for query parameter validation:
   - Test that missing required query parameters throw an error
   - Test that present required query parameters pass validation
   - Test that optional query parameters don't cause errors when missing
   - Test the error message format matches: "Missing required query parameter '{name}' for {method} {path}"
3. Use the existing testing framework and patterns in the codebase
4. Mock the ApiOperation and parameter data as needed
```

---

### Task 6: Add Unit Tests for Header Parameter Validation
**File:** Test file

**Changes:**
- Add test cases for validateHeaderParameters
- Similar coverage as query param tests

**Prompt for AI:**
```
Add unit tests for header parameter validation in the run-apis tool.

Requirements:
1. In the test file for openapi-tools.ts, add test cases for header parameter validation:
   - Test that missing required headers throw an error
   - Test that present required headers pass validation
   - Test that optional headers don't cause errors when missing
   - Test the error message format matches: "Missing required header '{name}' for {method} {path}"
2. Use the existing testing framework and patterns in the codebase
3. Mock the ApiOperation and parameter data as needed
```

---

### Task 7: Add Unit Tests for Request Body Validation
**File:** Test file

**Changes:**
- Add test cases for validateRequestBody
- Test body presence and required fields

**Prompt for AI:**
```
Add unit tests for request body validation in the run-apis tool.

Requirements:
1. In the test file for openapi-tools.ts, add test cases for request body validation:
   - Test that missing required request body throws an error
   - Test that missing required fields in body throw errors
   - Test that present required body and fields pass validation
   - Test that optional body doesn't cause errors when missing
   - Test the error message formats
2. Use the existing testing framework and patterns in the codebase
3. Mock the ApiOperation with requestBody schema data
```

---

### Task 8: Update Documentation/README
**File:** README.md or relevant docs

**Changes:**
- Document the new validation behavior
- Explain what parameters are validated
- Show examples of validation errors

**Prompt for AI:**
```
Update the documentation to describe the new parameter validation in the run-apis tool.

Requirements:
1. Find the section in README.md that describes the run-apis tool
2. Add a subsection about "Parameter Validation" that explains:
   - The tool now validates required parameters before making API calls
   - What gets validated: query parameters, headers, request body and fields, cookies
   - Path parameters were already validated (mention this)
   - Validation errors include clear messages about what's missing
3. Add an example of a validation error message
4. Keep the documentation concise and consistent with the existing style
```

---

## Execution Strategy

### Parallel Execution
Tasks 1-4 (implementation) can be executed in parallel or in any order, as they are independent of each other.

### Sequential Dependencies
- Task 5 depends on Task 1
- Task 6 depends on Task 2
- Task 7 depends on Task 3
- Task 8 should be done last after all features are implemented

### Recommended Order
1. **Phase 1 (Parallel):** Tasks 1, 2, 3, 4
2. **Phase 2 (Parallel):** Tasks 5, 6, 7
3. **Phase 3:** Task 8

## Expected Benefits

1. **Faster Feedback:** Users discover missing parameters immediately, not after a network round-trip
2. **Reduced Network Traffic:** Avoid making API calls that will definitely fail
3. **Better Error Messages:** Client-side validation can provide more context-aware error messages
4. **Improved Developer Experience:** Errors are caught before leaving the local environment
5. **API Consistency:** Validation matches OpenAPI specification requirements

## Estimated Effort

- **Per Implementation Task (1-4):** 15-30 minutes
- **Per Test Task (5-7):** 15-30 minutes
- **Documentation Task (8):** 10-15 minutes
- **Total:** ~2-4 hours for complete implementation

## Notes

- All validation will use existing OpenAPI schema metadata already loaded by the tool
- Error messages will follow the existing pattern used for path parameter validation
- Validation is fail-fast: throws error on first missing required parameter
- Optional parameters will never cause validation errors
