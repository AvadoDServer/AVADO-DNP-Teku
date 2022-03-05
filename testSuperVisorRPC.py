import xmlrpclib
server = xmlrpclib.Server('http://teku.my.ava.do:5556/RPC2')
# server.login("username","password")

# print(server.supervisor.getState())
print(server.system.listMethods())

# print(server.system.readLog())
print(server.supervisor.getState())
print(server.system.listMethods())
print(server.supervisor.getAllProcessInfo())
# print(server.supervisor.stopProcess("teku"))
print(server.supervisor.startProcess("teku"))