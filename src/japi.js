var java = require("java");
java.classpath.push("dolphindb.jar");

var listener = java.newProxy('com.xxdb.io.ProgressListener', {
    progress: function (msg) {
      // This is actually run on the v8 thread and not the new java thread
      console.log(msg);
    }
});

var conn = java.newInstanceSync("com.xxdb.DBConnection");
java.callMethodSync(conn,"connect", "localhost", 8848);
var re = java.callMethodSync(conn,"run", "if(true) print 'kkkkk'", listener);

function serializeDolphinDBObject(obj){
    
}




