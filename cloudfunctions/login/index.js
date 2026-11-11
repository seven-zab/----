// Unsafe legacy identity endpoints are retired. Use userService.bootstrap/getMe.
exports.main = async () => ({
  code: 400, error_code: 'ACTION_RETIRED', msg: '请更新客户端，使用身份申请与授权接口', data: null
});
