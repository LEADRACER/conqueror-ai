export function defineTool(input) {
    const result = {
        name: input.name,
        description: input.description,
        args: input.args,
        handler: input.handler,
    };
    if (input.hidden !== undefined) {
        result.hidden = input.hidden;
    }
    return result;
}
//# sourceMappingURL=types.js.map