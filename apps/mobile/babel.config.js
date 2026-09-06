module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // reanimated 4 يعتمد على worklets — يجب أن يكون آخر plugin
    plugins: ['react-native-worklets/plugin'],
  };
};
