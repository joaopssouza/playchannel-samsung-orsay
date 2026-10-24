/*
 * Configuracao do widget. NAO coloque usuario, senha nem token aqui:
 * o login e digitado na TV e fica so na memoria dela.
 *
 * bridgeUrl nao precisa ser editado a mao: o tools/build.py grava o endereco do seu
 * servidor ao empacotar (python tools/build.py --server http://IP-DO-SERVIDOR).
 */
var APP_CONFIG = {
    // Endereco do servidor da rede local que roda a ponte HTTP->HTTPS (veja a pasta server/)
    bridgeUrl: "http://SEU-SERVIDOR",
    // Dominio do servico de TV (a ponte repassa as chamadas para ele)
    providerHost: "tv.playchannel.com.br",
    // Usuario preenchido na tela de login (deixe vazio)
    defaultUser: ""
};
