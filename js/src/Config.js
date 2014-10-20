/**
 * Created by Sagar on 30/8/14.
 */
(function(){
OAuth.initialize('fjDZzYff0kMpDgKVm9dBkeb439g');
angular.module("abDataBrowser", ['ngAppbase', 'ngRoute', 'ng-breadcrumbs', 'ngDialog', 'easypiechart', 'ngAnimate'])
  .run(FirstRun)
  .config(Routes);

function FirstRun($rootScope, $location, stringManipulation){
  $rootScope.currentApp = sessionStorage.getItem('URL') ? stringManipulation.urlToAppname(sessionStorage.getItem('URL')) : '';
  $rootScope.$watch('currentApp', function(app){
    sessionStorage.setItem('URL', stringManipulation.appToURL(app));
  });
  $rootScope.goToApps = function() {
    $location.path('/');
  }
  $rootScope.goToBrowser = function(path) {
    path = path || ($rootScope.currentApp ? stringManipulation.appToURL($rootScope.currentApp) : '');
    $location.path('/browser/' + path);
  }
  $rootScope.goToStats = function(path){
    if(path) $rootScope.currentApp = path;
    else path = $rootScope.currentApp;
    $location.path('/stats/' + path);
  }
  $rootScope.goToOauth = function(path){
    if(path) $rootScope.currentApp = path;
    else path = $rootScope.currentApp;
    $location.path('/oauth/' + path);
  }

} 

function Routes($routeProvider){
  var browser = {
    controller: 'browser',
    templateUrl: 'html/browser.html'
  }, stats = {
    controller: 'stats',
    templateUrl: 'html/stats.html'
  }, apps = {
    controller: 'apps',
    templateUrl: 'html/apps.html'
  }, signup = {
    controller: 'signup',
    templateUrl: 'html/signup.html'
  }, oauth = {
    controller: 'oauthd',
    templateUrl: 'html/oauth.html'
  };

  $routeProvider
    .when('/', apps)
    .when('/signup', signup)
    .when('/browser', browser)
    .when('/browser/:path*', browser)
    .when('/stats/:path*', stats)
    .when('/stats', stats)
    .when('/oauth/:path*', oauth)
    .when('/oauth', oauth)
    .otherwise({ redirectTo: '/' });
}
})();

