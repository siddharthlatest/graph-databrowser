(function(){
angular.module('AppbaseDashboard', ['ngAppbase',
                                    'ngRoute',
                                    'ng-breadcrumbs',
                                    'ngAnimate',
                                    'ngDialog',
                                    'highcharts-ng',
                                    'ngClipboard'])
  .run(Authenticate);

function Authenticate($rootScope, session, $appbase, $timeout, $location, Apps, $routeParams) {

  if(!localStorage.getItem('devProfile') || localStorage.getItem('devProfile') === 'null'){
    Apps.clear();
    session.setProfile(null);
    $rootScope.logged = false;
    $location.path('/login');
  } else $rootScope.logged = true;

  auth();

  $rootScope.$watch('logged', function(logged){
    if(logged) auth();
  });

  document.addEventListener('logout', logout);
  document.addEventListener('postLogin', login);

  function auth(){
    $rootScope.devProfile = session.getProfile();
    if($rootScope.devProfile) {
      Apps.refresh();
    }
  }

  function logout(){
    $timeout(function(){
      $rootScope.logged = false;
      $appbase.unauth();
      Apps.clear();
      session.setProfile(null);
      $location.path('/login');
    });
  }

  function login(){
    $timeout(function(){
      $rootScope.logged = true;
      $location.path('/');
    });
  }

  $rootScope.where = function(here) {
    var path = $location.path().split('/');
    if( ($routeParams.app || path[1] === 'apps') && here === 'apps') return true;
    return here ? (path[1] === here) : path[1];
  }

}

})();



(function(){
angular
.module('AppbaseDashboard')
.controller('apps',
  [
    '$route',
    '$location',
    '$rootScope',
    '$scope',
    '$timeout',
    'Apps',
    'Loader',
    'session',
    'data',
    'utils',
    AppsCtrl
  ]
);

function AppsCtrl($route, $location, $rootScope, $scope, $timeout, Apps, Loader, session, data, utils){
  $scope.apps = Apps.get();
  $scope.fetching = true;
  $scope.api = false;
  $scope.devProfile = $rootScope.devProfile = session.getProfile();
  
  Loader(25);

  refresh();

  function refresh(done){
    Apps.refresh().then(function(apps){
      Loader(80);
      $timeout(function(){
        if(!apps.length) tutorial();
        $scope.apps = apps;
        apps.forEach(function(app){
          var promises = ['metrics', 'secret'];
          promises.forEach(function(prop){
            app['$' + prop]();
          });
        });
        Loader(100);
        $scope.fetching = false;
        if(done) done();
      });
    }, sentry, function(){
      Loader(70);
    });
  }

  function tutorial(){
    if(!session.getProfile()) return;
  }

  $scope.goToDash = function(app) {
    $location.path('/' + app + '/dash');
  }

  $scope.createApp = function (app) {
    $scope.creating = true;
    $scope.fetching = true;
    Loader(20);
    data.createApp(app).then(function(){
      $timeout(function(){
        $scope.goToDash(app);
      });
    }).catch(function(){
      $scope.creating = false;
      $scope.fetching = false;  
      alert('Name taken. Try another name.');
    });
  };

  $scope.copy = function(app) {
    $timeout(function(){
      app.copied = true;
    });

    $timeout(function(){
      app.copied = false;
    }, 1500);
  }
}
})();
(function(){
angular
.module('AppbaseDashboard')
.factory('Apps', AppsFactory);

function AppsFactory(session, data, $q, $timeout, $rootScope, $routeParams, utils, $location){
  var apps = getFromSession();
  var refreshing = false;
  var callsCalc = false;
  var updated = false;
  var calls = {};
  var appNamesToObj = utils.appNamesToObj;
  var appObjToNames = utils.appObjToNames;

  $rootScope.$on('$routeChangeSuccess', updateOrder);

  var retObj = {
    get: function(){
      return apps;
    },
    set: function(_apps){
      apps = _apps;
      session.setApps(apps);
    },
    clear: function(){
      apps = [];
      session.setApps([]);
    },
    updated: function(){
      return updated;
    },
    refresh: refresh,
    write: write,
    appFromName: appFromName
  };

  function appFromName(name){
    var deferred = $q.defer();

    if (apps && apps.length) {
      var app = getApp(name);
      if(app) deferred.resolve(app);
      else
        refresh().then(function(){
          var app = getApp(name);
          if(app) deferred.resolve(app);
          else {
            deferred.reject();
            $location.path('/apps');
          }
        }, function(){
          deferred.reject();
          $location.path('/apps');
        });
    }

    return deferred.promise;

    function getApp(name){
      var filter = apps.filter(function(each){
        return each.name === name;
      });
      return filter.length ? filter[0] : false;
    }
  }

  function updateOrder(next, current){
    var app = current && current.params && current.params.app;
    var profile = session.getProfile();

    if(app && profile && profile.uid) {
      var appObj = apps.filter(function(_app){
        return _app.name === app;
      })[0];

      var order = localStorage.getItem(profile.uid + 'order') || appObjToNames(apps);
      order = angular.isArray(order) ? order : JSON.parse(order);

      var indexOrder = order.indexOf(app);
      if(indexOrder !== -1) order.splice(indexOrder, 1);
      order.unshift(app);
      
      var indexSession = apps.indexOf(appObj);
      if(indexSession !== -1) apps.splice(indexSession, 1);
      apps.unshift(appObj);
      write();
      
      localStorage.setItem(profile.uid + 'order', JSON.stringify(order));
    }
  }

  function updateCalls(){
    if(callsCalc) return;

    var props = Object.getOwnPropertyNames(calls);
    if(props.length < apps.length) return;

    var total = 0;
    props.forEach(function(prop){
      total += calls[prop];
    });

    callsCalc = true;
    var stats = { calls: total, apps: apps.length };
    $rootScope.$broadcast('intercomStats', stats);
  }

  function write(){
    session.setApps(apps);
  }

  function getFromSession(){
    return attachAllPromises(session.getApps());
  }

  function refresh(){
    if(angular.isObject(refreshing)){
      return refreshing;
    }
    var deferred = $q.defer();
    refreshing = deferred.promise;
    session.fetchApps().then(function(_apps){
      deferred.notify();
      updated = true;
      refreshing = false;

      var appsObj = appNamesToObj(_apps);
      appsObj.forEach(function(app){
        var index;
        apps.every(function(oldApp, _index){
          if(oldApp.name === app.name) {
            index = _index;
            return false;
          }
          return true;
        });
        if(index) {
          Object.getOwnPropertyNames(apps[index]).forEach(function(prop){
            if(!prop.lastIndexOf('$', 0)) return;
            app[prop] = apps[index][prop];
          });
        }
      });
      $timeout(function(){
        apps = attachAllPromises(appsObj);

        session.setApps(apps);
        var profile = session.getProfile();
        if(profile && profile.uid) {
          localStorage.setItem(profile.uid + 'order', JSON.stringify(_apps));
          if(!apps.length) {
            $rootScope.$broadcast('intercomStats', { calls: 0, apps: 0 });
          }
        }
        
        deferred.resolve(apps);
      });
    }).catch(function(err){
      refreshing = false;
      deferred.reject(err);
    });

    return deferred.promise;
  }

  function attachAllPromises(_apps){
    var appsArr = [];
    _apps.forEach(function(app){
      appsArr.push(attachPromises(app));
    });

    return appsArr;
  }

  function attachPromises(appObj){
    if(angular.isString(appObj)) appObj = { name: appObj };

    var deferred = $q.defer();
    deferred.resolve();
    var emptyPromise = deferred.promise;
    
    appObj.$metrics = function(){
      if(!appObj.metrics){
        return data.accountsAPI.app.get(appObj.name, 'metrics').then(function(data){
          appObj.stats = computeMetrics(data);
          appObj.metrics = data;

          calls[appObj.name] = appObj.stats.calls;
          updateCalls();
        });
      }
      return emptyPromise;
    };

    appObj.$version = function(){
      var deferred;
      var v3date = 1427147200000; //4/1/2015

      if(!appObj.version){
        deferred = $q.defer();
        appObj.$secret(true).then(function(){
          appObj.version = appObj.createdAt > v3date ? 3 : 2;
          deferred.resolve();
        }, deferred.reject);
      } else return emptyPromise;

      return deferred.promise;
    };

    appObj.$secret = function(created){
      if(!appObj.secret || created){
        return data.getAppsSecret(appObj.name).then(function(data){
          appObj.createdAt = data.created_at || 1388534400; // 1/1/2014
          appObj.secret = data.secret;
          write();
        });
      }
      return emptyPromise;
    };
    return appObj;
  }

  function computeMetrics(metrics){
    var totalRecords = 0;
    var totalCalls = 0;
    totalRecords += parseInt(metrics.edgesAndVertices.Vertices) || 0;
    totalRecords += parseInt(metrics.edgesAndVertices.Edges) || 0;

    var calls = metrics.calls && Object.keys(metrics.calls);
    if(calls && calls.length) {
      calls.forEach(function(call){
        totalCalls += call.indexOf('APICalls') !== -1 ? metrics.calls[call] : 0;
      });
    }

    return { records: totalRecords, calls: totalCalls };
  }

  return retObj;
}

})();
(function(){
angular
.module('AppbaseDashboard')
.controller('billing', BillingCtrl);

function BillingCtrl($routeParams, utils, $scope, session, $rootScope, $location, $timeout, $document){
  //var stripeKey = 'pk_SdFKltkp5kyf3nih2EypYgFVOqIRv';//test key
  var stripeKey = 'pk_XCCvCuWKPx07ODJUXqFr7K4cdHvAS'; //production key
  if($scope.devProfile = session.getProfile()) {
    $('body').append($('<div>').load('/developer/html/dialog-payment.html'));

    var userProfile = JSON.parse(localStorage.getItem('devProfile'));
    var plan;
    var $button;
    
    loaded();

    function loaded(){ 
      Stripe.setPublishableKey(stripeKey);  

      $.ajax({
        url:['https://transactions.appbase.io/getCustomer/',userProfile.email].join(''),
        type: 'get',
        success: function(data){
          //if user just signed up, show credit card stuff.
          if($location.search().plan && data.stripeId === null){
            $('.button-subscribe').filter(['[data-plan=',$location.search().plan,']'].join('')).trigger('click');
          }
          localStorage.setItem('customer',JSON.stringify(data));
          $('#plans button').filter(['[data-plan="',data.plan,'"]'].join(''))
            .html('Your Current Plan')
            .attr('disabled','disabled')
            .removeClass('btn-success')
            .addClass('btn-primary');

          if(data.customer) {
            if(data.stripeId != null && data.customer.subscription != null){
              $('#plans button').filter(['[data-plan != "',data.plan,'"]'].join(''))
                .html('Change Plan')
                .removeAttr('disabled')
                .addClass('btn-success')
                .removeClass('btn-primary');
              
              $('.button-subscribe').off('click');
              
              $('.button-subscribe').on('click',function(e){
                $this = $(this);
                var a = new BootstrapDialog({
                    title: 'Change plan',
                    message: 'Are you sure you want to change your plan to '+ $(this).data('text')+'?',
                    closable: false,
                    cssClass: 'confirm-del',
                    buttons: [{
                        label: 'No',
                        cssClass: 'btn-no',
                        action: function(dialog) {
                            dialog.close();
                        }
                    }, {
                        label: 'Yes',
                        cssClass: 'btn-yes',
                        action: function(dialog) {
                          if(data.customer.subscriptions.data[0]){
                            plan = $this.data('plan');
                            stripeId = data.stripeId; 
                            subscriptionId = data.customer.subscriptions.data[0].id;
                            $.ajax({
                              url:'https://transactions.appbase.io/changePlan',
                              type: 'post',
                              beforeSend: function(){
                                $this.html('Changing Plan...');
                              },
                              data: {stripeId:stripeId,subscriptionId:subscriptionId,plan:plan,email:userProfile.email},
                              success: function(){
                                if(typeof(ga) === 'function')
                                  ga('send', 'event', { eventCategory: 'subscribe', eventAction: 'plan', eventLabel: plan});
                                loaded();
                                $('#cancel-subscription').prop('disabled', false);
                              }
                            });
                          }
                          dialog.close();
                        }
                    }]
                }).open();     
                
                
                e.preventDefault();
              });

              //build subscription info
            
              subscriptions = data.customer.subscriptions;
              if(subscriptions.data.length){
                var dateStart = new Date(subscriptions.data[0].start * 1000);
                var datePeriodStart = new Date(subscriptions.data[0].current_period_start * 1000);
                var datePeriodEnd = new Date(subscriptions.data[0].current_period_end * 1000);

                $('#my-subscription').removeClass('hide');
                $('#subscription-start').html(dateStart.toDateString());
                $('#period-start').html(datePeriodStart.toDateString());
                
                if(!subscriptions.data[0].cancel_at_period_end){
                  $('#period-end').html(datePeriodEnd.toDateString());
                } else {
                  $('#cancel-subscription').prop('disabled', true);
                  $('#period-end').html(['<strong>',datePeriodEnd.toDateString(),'</strong> - The subscription will be canceled at this date. <br><strong>You can still change your plan before billing cycle is over.</strong>'].join(''));
                }
              }
            }
          } else {
            $('.button-subscribe').on('click',function(e){
              $('#payment_modal').modal();
              if(sessionStorage.getItem('discount')){
                $('#payment_modal #coupon').val('PHUNT30');
              }
              $button = $(this);
              plan = $(this).data('plan');
              $('#modal-plan').html($(this).data('text'));
              $('#email').val(userProfile.email);
              $('#modal-price').html(['$',(parseFloat($(this).data('amount'))/100).toFixed(2)].join(''));
              e.preventDefault();
            });
          }
        }
      });
      
      $('#cancel-subscription').on('click',function(e){
        e.preventDefault();
        $this = $(this);

        var a = new BootstrapDialog({
            title: 'Change plan',
            message: 'Are you sure you want to cancel your subscription?',
            closable: false,
            cssClass: 'confirm-del',
            buttons: [{
                label: 'No',
                cssClass: 'btn-no',
                action: function(dialog) {
                    dialog.close();
                }
            }, {
                label: 'Yes',
                cssClass: 'btn-yes',
                action: function(dialog) {
                  var customer = JSON.parse(localStorage.getItem('customer'));
                  var stripeId = customer.stripeId; 
                  var subscriptionId = customer.customer.subscriptions.data[0].id;
                  
                  $.ajax({
                    url:'https://transactions.appbase.io/cancelSubscription',
                    type: 'post',
                    beforeSend: function(){
                      $this.html('Canceling Subscription...');
                    },
                    data: {stripeId:stripeId,subscriptionId:subscriptionId,email:userProfile.email},
                    success: function(data){
                      if(typeof(ga) === 'function')
                        ga('send', 'event', { eventCategory: 'subscribe', eventAction: 'cancel', eventLabel: customer.plan});
                      $('#plans button')
                        .html('Subscribe')
                        .removeClass('btn-success')
                        .addClass('btn-primary')
                        .removeAttr('disabled');
                      $this.html('Cancel Subscription');
                      loaded();
                    }
                  });
                  dialog.close();
                }
            }]
        }).open();  
        
      });

      $('body').on('submit','#payment-form',function(event) {
        var $form = $(this);

        // Disable the submit button to prevent repeated clicks
        $form.find('button').prop('disabled', true);

        Stripe.card.createToken($form, stripeResponseHandler);

        // Prevent the form from submitting with the default action
        event.preventDefault();
      });

      function stripeResponseHandler(status, response) {
        var $form = $('#payment-form');
        if (response.error) {
          // Show the errors on the form
          $form.find('.payment-errors').text(response.error.message);
          $form.find('button').prop('disabled', false);
        } else {
          var coupon = $('#coupon').val();
          // response contains id and card, which contains additional card details
          var token = response.id;
        
          $.ajax({
            url:'https://transactions.appbase.io/subscribe',
            type: 'post',
            data: {token: token, email: userProfile.email, plan: plan, coupon: coupon},
            beforeSend: function(){
              $button.html('Subscribing...');
            },
            success: function(data){
              $('#payment_modal').modal('hide');
              if(typeof(ga) === 'function')
                ga('send', 'event', { eventCategory: 'subscribe', eventAction: 'plan', eventLabel: plan});
              loaded();
              $form.find('button').prop('disabled', false);
            },
            error: function(jqXHR,data,errorThrown){
              $form.find('button').prop('disabled', false);
              $form.find('.payment-errors').text(jqXHR.responseText);
              $button.html('Subscribe');
            }
          });
          
        }
      };
    } 
  }
}

})();
(function(){
angular
.module('AppbaseDashboard')
.controller("browser",
             ['$scope', '$appbase', '$timeout', 'data', 'utils', 'breadcrumbs', 'ngDialog',
             'nodeBinding', 'session', '$rootScope', 'Apps', '$routeParams', '$route', BrowserCtrl]);

function BrowserCtrl($scope, $appbase, $timeout, data, utils,
  breadcrumbs, ngDialog, nodeBinding, session, $rootScope, Apps, $routeParams, $route){

  $rootScope.$on('routeUpdate', function(){
    console.log('update')
  })
  var apps = Apps.get();
  $scope.status = "Loading";
  var appName = $scope.app = $routeParams.app;
  var URL, app;

  Apps.appFromName(appName).then(function(_app){
    app = _app;
    URL = session.getBrowserURL(apps);

    if(!URL || utils.urlToAppname(URL) !== appName) {
      URL = utils.appToURL(appName);
      session.setBrowserURL(URL);
    }

    app.$secret().then(function(data){
      gotSecret(app.secret);
    });

  });

  function gotSecret(secret){
    data.setAppCredentials(appName, secret);
    $scope.url = URL;
    $scope.goUp = function() {
      URL = utils.parentUrl($scope.url);
    }
    var path = utils.urlToPath($scope.url);

    if(path === undefined) {
      $scope.node = nodeBinding.bindAsRoot($scope)
    } else if(path.indexOf('/') === -1) {
      $scope.node = nodeBinding.bindAsNamespace($scope, path)
    } else {
      $scope.node = nodeBinding.bindAsVertex($scope , path)
    }
    $scope.node.expand()

    $scope.baseUrl = utils.cutLeadingTrailingSlashes(utils.getBaseUrl());

    $scope.breadcrumbs = (path === undefined)? undefined : breadcrumbs.generateBreadcrumbs(path)
    $scope.status = false;
  }

  $scope.goToBrowser = function(path) {
    session.setBrowserURL(path);
    $route.reload();
  }
  
  $scope.addEdgeInto = function(node) {
    var namespaces = [];
    node.loadingNs = true;
    data.getNamespaces().then(function(array) {
      $timeout(function(){
        node.loadingNs = false;
      });
      array.forEach(function(each){
        namespaces.push(each.name);
      });
      ngDialog.open({
        template: '/developer/html/dialog-new-vertex.html',
        controller: ['$scope', function($dialogScope) {
          $dialogScope.namespaces = namespaces;
          $dialogScope.node = node;
          if (!node.isV) {
            $dialogScope.title = "Add Vertex"
          } else {
            $dialogScope.title = "Add Out-vertex at path: " + node.ref.path();
          }
          if(node.isNS) {
            $dialogScope.namespaceSelected = node.name;
          }
          $dialogScope.text = "in " + node.name
          $dialogScope.vTypeOptions = ['New Vertex', 'Existing Vertex']
          $dialogScope.vType = $dialogScope.vTypeOptions[0]

          $dialogScope.done = function() {
            var prepareParams = function() {
              var params = {}
              if($dialogScope.vType === $dialogScope.vTypeOptions[0]) { // New Vertex
                params.namespace =
                  ($dialogScope.namespaceSelected === undefined || $dialogScope.namespaceSelected === null) ?
                  $dialogScope.namespaceNew : $dialogScope.namespaceSelected
                params.vId = ($dialogScope.vId === undefined || $dialogScope.vId === "") ? $appbase.uuid() : $dialogScope.vId
                params.ref = $appbase.ns(params.namespace).v(params.vId)
              } else {
                params.vPath = $dialogScope.vPath
                var parsedPath = utils.parsePath(params.vPath);
                params.ref = $appbase.ns(parsedPath.ns).v(parsedPath.v);
              }

              params.eName = 
                ($dialogScope.eName === undefined || $dialogScope.eName === "") ?
                (params.vId === undefined? $appbase.uuid() : params.vId) : $dialogScope.eName
              params.pR = ($dialogScope.pR === undefined || $dialogScope.pR === null) ? undefined : $dialogScope.pR

              return params
            }
            var params = prepareParams()
            if(node.isV) {
              if(params.pR !== undefined) {
                node.ref.setEdge(params.eName, params.ref, params.pR)
              }
              else {
                node.ref.setEdge(params.eName, params.ref)
              }
            } else if(node.isR) {
              if(!nodeBinding.addNamespaces(node, params.namespace)) {
                node.children.unshift(nodeBinding.bindAsNamespace($scope, params.namespace))
              }
            }
            $dialogScope.closeThisDialog()
          }

          $dialogScope.no = function() {
            $dialogScope.closeThisDialog()
          }
        }],
        className: 'ngdialog-theme-dialog-small',
        showClose: false
      });


    });
  }
}
})();
(function(){
angular
.module('AppbaseDashboard')
.factory('DashboardBuild', DashboardBuild)
.controller('dash', DashCtrl);

function DashboardBuild($routeParams, $rootScope, Apps, $q, Loader){
  var scopeData = {};

  Loader(25);
  var retObj = {
    build: function(app){
      var deferred = $q.defer();

      scopeData = {};
      Apps.appFromName(app).then(function(_app){
        scopeData.app = _app;
        scopeData.app.$metrics().then(function(){
          Loader(65);
          var metrics = scopeData.app.metrics;
          scopeData.vert = metrics.edgesAndVertices.Vertices || 0;
          scopeData.edges = metrics.edgesAndVertices.Edges || 0;
          defaultValues(metrics, scopeData);
          $rootScope.$watch('balance', function(val){
            scopeData.cap = val || 100000;
          });
          graph(scopeData);
          deferred.resolve();
        });
      });
  
      return deferred.promise;
    },
    get: function(){
      return scopeData;
    }
  };

  return retObj;
}

function DashCtrl($scope, DashboardBuild, Loader){
  Loader(100);
  $scope.data = DashboardBuild.get();

  $scope.graph = function(timeFrame){
    return graph($scope.data, timeFrame);
  }

  $scope.commas = function(number) {
    if(number) return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

}

function defaultValues(metrics, obj){
  obj.strike = {};
  obj.noData = metrics && !angular.isObject(metrics.calls);

  obj.cap = 100000;
  
  obj.chart = {};
  obj.chart.month = 0;

  obj.chartConfig = {
    options: {
        chart: { type: 'spline' },
        tooltip: {
            style: {
                padding: 10,
                fontWeight: 'bold'
            }
        },
        colors: ['#50BAEF', '#13C4A5'],
    },
    series: [],
    xAxis: { categories: [] },
    yAxis: { title: '', floor: 0 },
    loading: true,
    title: { text: '' }
  };
}

function graph(scope, timeFrame){
  var metrics = scope.app.metrics;
  var labels = {
    rest: 'REST API Calls',
    search: 'Search API Calls',
    socket: 'Socket API Calls'
  };

  var now = new Date();
  var utc = new Date(now.getTime() + now.getTimezoneOffset() * 60000);

  var presets = {
    week: function(){
      scope.graphActive = 'week';
      timeFrame = utc.setDate(utc.getDate() - 7);
    },
    month: function(){
      scope.graphActive = 'month';
      timeFrame = utc.setMonth(utc.getMonth() - 1);
    },
    all: function(){
      scope.graphActive = 'all';
      timeFrame = 0;
    }
  }

  if(!timeFrame) timeFrame = 'month';
  if(presets[timeFrame]) {
    var timeLabel = timeFrame;
    presets[timeFrame]();
  }

  var retVal = getGraphData(timeFrame, metrics);
  var data = retVal.data;

  if(!$.isEmptyObject(data)){
    scope.chart.month = scope.chart.month || retVal.month;

    scope.chartConfig.xAxis.categories =   retVal.xAxis;
    scope.chartConfig.series = [];

    Object.keys(data).forEach(function(type){
      scope.chartConfig.series.push({
        data: data[type],
        name: labels[type]
      });
    });
  } else {
    if(timeLabel && timeLabel !== 'all') {
      scope.strike[timeLabel] = true;
      graph(scope, timeLabel === 'week' ? 'month' : 'all');
    }
  }

  scope.chartConfig.loading = false;

}

function getGraphData(timeFrame, metrics){
  var calls = metrics.calls;
  var month = 0;
  var metrics = {};
  var xAxis = [];
  var types = ['rest', 'socket', 'search'];
  types.forEach(function(type){
    metrics[type] = [];
  });

  // better performance than keys
  for (var key in calls){
    if(key.indexOf('APICalls') !== -1) {
      var split = key.split(':');
      var date = parseInt(split[0]);
      if(date > timeFrame) {
        if(xAxis[xAxis.length-1] != date) {
          updateArraySize();
          xAxis.push(date);
        }
        var value = calls[key];
        month += value;
        types.forEach(function(type){
          if(key.indexOf(type) !== -1){
            metrics[type].push(value);
          };
        });
      }
    }
  }
  updateArraySize();

  types.forEach(function(type){
    if(!metrics[type].filter(function(data){
      return data != 0;
    }).length) {
      delete metrics[type];
    }
  });

  var xAxisLabels = [];
  xAxis.forEach(function(date){
    date = new Date(date);
    var formated = (date.getMonth()+1) + '/' + date.getDate();
    xAxisLabels.push(formated);
  });

  return { data: metrics, xAxis: xAxisLabels, month: month };

  function updateArraySize(){
    var lengths = [];
    var max = 0;
    types.forEach(function(type){
      var length = metrics[type].length;
      max = length > max ? length : max;
    });
    types.forEach(function(type){
      var obj = metrics[type];
      if(obj.length < max) obj.push(0);
    });
  }
}


})();
(function(){
angular
.module('AppbaseDashboard')
.directive('imgSrc', ImgSrc)
.directive('backgroundColor', BackgroundColor)
.directive('abModalShow', ModalShow)
.directive('hideParent', HideParent)
.directive('showParent', ShowParent)
.directive('loadingLine', LoadingLine)
.directive('abModal', Modal)
.directive('abTooltip', Tooltip);

function Tooltip(){
  return {
    restrict: 'A',
    link: function(scope, element, attrs){
      $(element).tooltip({ trigger: "hover" });
    }
  }
}

function Modal(){
  var rememberCache = {};

  function link(scope, element, attrs){
    var el = $(element);

    var input = '<div class="form-group text">'
    + '<input type="text" class="form-control"/></div>';

    var checkboxActive = '<div class="checkbox"><label>'
    + '<input type="checkbox" checked class="check">'
    + ' Remember choice </label> </div>';

    var checkboxInactive = '<div class="checkbox"><label>'
    + '<input type="checkbox" class="check">'
    + ' Remember choice </label> </div>';

    el.click(function(){
      if(scope.abRemember && rememberCache[scope.abRemember]) {
        scope.abCallback();
        return;
      }

      var message = scope.abInput ? (scope.abMessage + input) : scope.abMessage;
      message = scope.abInclude ? $('<div></div>').load(scope.abInclude) : message;

      var cssClass = 'modal-custom';
      cssClass += scope.abClass ? (' ' + scope.abClass) : '';

      var title = scope.abTitle || 'Message';
      var callback;
      var buttons = [];

      if(angular.isFunction(scope.abCallback)) {
        if(scope.abRemember && !scope.abInclude){
          message += scope.abChecked ? checkboxActive : checkboxInactive;
        }

        callback = function(text, remember, dialog){
          if(scope.abRemember) rememberCache[scope.abRemember] = remember;
          scope.abCallback(text);
          dialog.close();
        }

        buttons = [{
            label: 'Cancel',
            cssClass: 'btn-no',
            action: function(dialog) {
              dialog.close();
            }
          }, {
            label: 'Yes',
            cssClass: 'btn-yes',
            action: function(dialog) {
              if(!angular.isFunction(callback)) return;

              var input = scope.abInput ? dialog.getModalBody().find('.text') : '';
              var text = input.length ? input.find('input').val() : '';
              var remember = scope.abRemember?dialog.getModalBody().find('.check').is(':checked'):false;

              if(scope.abInput && scope.abValidate) {
                if(text === scope.abValidate) {
                  callback(text, remember, dialog);
                } else {
                  input.addClass('has-error');
                }
              } else {
                callback(text, remember, dialog);
              }
            }
        }];
      }

      BootstrapDialog.show({
        message: message,
        cssClass: cssClass,
        title: title,
        buttons: buttons
      });
    });
  }

  return {
    restrict: 'A',
    scope: {
      abCallback: '=',
      abMessage: '@',
      abTitle: '@',
      abClass: '@',
      abInclude: '@',
      abInput: '=',
      abValidate: '=',
      abChecked: '=',
      abRemember: '='
    },
    link: link
  }
}

function LoadingLine($rootScope){
  return {
    restrict: 'C',
    scope: {
      loading: '='
    },
    link: function(scope, element, attrs) {
      var toReset;
      var element = $(element);
      var glow = element.next();

      scope.$watch('loading', function(progress){ 
        if(toReset) {
          element.stop().css('width', progress + 'vw');
          glow.stop().css('left', progress + 'vw');
          toReset = false;
        }

        if(progress > 0) element.parent().stop(false, false).css('opacity', 1);

        setWidth(progress);

        if(progress >= 100) {
          element.parent().delay(800).animate({opacity: 0});
          toReset = true;
        }
          
        function setWidth(width) {
          width = width + 'vw';
          element.animate({'width': width});
          glow.animate({'left': width});
        }

      });
    }
  }
}

function ImgSrc(){
  return {
    scope: {
      src: '@'
    },
    link: function(scope, element, attrs) {
      attrs.$observe('src', function(src){
        element.css('display', 'block');
      });
      element.bind('error', function(err) {
        element.css('display', 'none');
      });
    }
  } 
}

function ModalShow($timeout) {
  return {
    restrict: 'A',
    scope: {
      abModalShow: '='
    },
    link: function(scope, element){
      scope.$watch('abModalShow', function(bool){
        if(bool) element.modal('show');
      });
      $(element).on('hide.bs.modal', function (e) {
        $timeout(function(){
          scope.abModalShow = false;
        });
      })
    }
  }
}

function BackgroundColor() {
  return {
    restrict: 'A',
    scope: {
      backgroundColor: '='
    },
    link: function(scope, element){
      scope.$watch('backgroundColor', function(color){
        element.css('background-color', color);
      });
    }
  }
}

function HideParent() {
  return {
    restrict: 'A',
    link: function (scope, element) {
      if(!element.closest('.child').length) {
        element.hide();
      }
    }
  }
}

function ShowParent() {
  return {
    restrict: 'C',
    link: function (scope, element) {
      if(!element.closest('.child').length) {
        element.show();
      }
    }
  }
}

})();
if(window.Raven) {
	window.Raven.config('https://08f51a5b99d24ba786e28143316dfe5d@app.getsentry.com/39142').install();
}
window.localEnv = window.location.hostname === '127.0.0.1';

function sentry(error) {
  if(Raven) {
    Raven.captureException(error);
  } else {
    throw new Error(error);
  }
}

function debug(obj) {
  return JSON.parse(JSON.stringify(obj))
}

(function(){

angular.module('AppbaseDashboard')
  .run(ExternalLibs);

function ExternalLibs($rootScope, $window, session, $location){
	var unknownUser = {
	  name: 'unknown',
	  email: 'unknown',
	  uid: 'unknown'
	};

	document.addEventListener('postLogin', updateLibs);
	if($rootScope.logged) updateLibs();
	$rootScope.$watch('looged', function(logged){
		if(logged) updateLibs();
	});

	function updateLibs(){
		var user = session.getProfile() || unknownUser;

		$window.Raven.setUser({
		    email: user.email,
		    id: user.uid
		});

		$window.Intercom('boot', {
		  app_id: "jnzcgdd7",
		  name: user.name,
		  email: user.email
		});
		
		$rootScope.$on('intercomStats', updateIntercom);
		$rootScope.$on('$routeChangeSuccess', function(){
		  if(window.localEnv) {
		  	setTimeout(function() {
		  		$('a').each(function(){
			  		var el = $(this);
			  		var href = el.attr('href');
			  		if(href && href.indexOf('/developer/') !== -1 && href.indexOf('/developer/#/') === -1) {
			  			href = href.split('/developer/');
			  			href[0] = '/developer/#/';
			  			el.attr('href', href.join(''));
			  		}
			  	});
		  	}, 500);
		  }
		  $window.Intercom('update');
		  if(typeof(ga) === 'function'){
		    ga('send', 'pageview', ['/developer',$location.path()].join(''));
		  }
		});
	}

	function updateIntercom(evt, stats){
		var user = session.getProfile() || unknownUser;

		$window.Intercom('update', {
		  name: user.name,
		  email: user.email,
		  calls: stats.calls,
		  apps: stats.apps
		});
	}
}

})();
(function(){
angular
.module('AppbaseDashboard')
.factory('data',
  ['$timeout', '$location', '$appbase', 'utils', '$q', '$http', DataFactory]);

function DataFactory($timeout, $location, $appbase, utils, $q, $http) {
  var data = {};
  var appName;
  var secret;
  var server = "Ly9hY2NvdW50cy5hcHBiYXNlLmlvLw==";

  var accountsAPI = data.accountsAPI = (function(){
    var points = ['user', 'app'];
    var methods = ['get', 'post', 'patch', 'put', 'delete'];
    var retObj = {};

    function req(method, point, subject, endpoint, body){
      if(angular.isObject(endpoint)) {
        body = endpoint;
        endpoint = '';
      }
      if(!endpoint) endpoint = '';
      if(!body) body = '';

      return request(method, point, subject, body, endpoint);
    }

    points.forEach(function(point){
      methods.forEach(function(method){
        retObj[point] = retObj[point] || {};
        retObj[point][method] = function(subject, endpoint, body){
          return req(method, point, subject, endpoint, body);
        };
      });
    });

    return retObj;
  })();

  function getEmail(){
    var profile = JSON.parse(localStorage.getItem('devProfile'));
    return profile? profile.email : undefined;
  }

  function getUID(){
    var profile = JSON.parse(localStorage.getItem('devProfile'));
    return profile? profile.uid : undefined;
  }

  data.setAppCredentials = function(app, s) {
    $appbase.credentials(app, s);
    appName = app;
    secret = s;
    utils.setBaseUrl(utils.appToURL(appName));
  }

  data.getAppname = function() {
    return appName;
  }

  data.getNamespaces = function(done) {
    var deferred = $q.defer();

    $http({
      method: 'GET',
      url: 'https://v3.api.appbase.io/' + appName + '/~collections',
      headers: {
        'Content-Type': 'application/json',
        'Appbase-Secret': secret
      }
    }).then(function(result){
      var namespaces = [];
      result.data.forEach(function(ns){
        namespaces.push({name: ns});
      });
      deferred.resolve(namespaces);
    });

    return deferred.promise;
  };

  data.deleteNamespace = function(namespace, done) {
    var body = {namespace: namespace, secret: secret};
    accountsAPI.app.delete(appName, 'namespaces', body).then(done);
  }

  data.createApp = function(app, done) {
    var deferred = $q.defer();

    accountsAPI.app.put(app).then(function(response){
      if(typeof response === "string") {
        deferred.reject();
      } else if(angular.isObject(response)) {
        $q.all(
          accountsAPI.user.put(getEmail(), {appname: app}),
          accountsAPI.app.put(app, 'owners', {owner: getEmail()})
        ).then(deferred.resolve).catch(deferred.reject);
      } else {
        if(angular.isObject(response) || angular.isArray(response)){
          response = JSON.stringify(response);
        }
        sentry(new Error('App creation unexpected return ' + response));
        deferred.reject();
      }
    });

    return deferred.promise;
  } 

  data.putUser = function(app, user) {
    return accountsAPI.app.put(app, 'users', {user: user});
  };

  data.deleteUser = function(app, user) {
    return $q.all(
      accountsAPI.user.delete(user, {appname: app}),
      accountsAPI.app.delete(app, 'users', {user: user})
    );
  };

  data.putApp = function(user, app) {
    return accountsAPI.user.put(user, {appname: app});
  };

  data.deleteApp = function(app, secret) {
    return $q.all(
      accountsAPI.app.delete(app, {kill: true, secret: secret}),
      accountsAPI.user.delete(getEmail(), {appname: app})
    );
  }
  
  // checks if the user has any apps with registered with uid, pushes them with emailid
  data.uidToEmail = function(done) {
    var UID = getUID();
    if(UID) {
      accountsAPI.user.get(getUID()).error(sentry).then(function(apps) {
        if(!apps.length) return done();
        var appsRemaining = apps.length;
        var checkForDone = function() {
          appsRemaining -= 1;
          if(appsRemaining === 0) {
            done();
          }
        }
        apps.forEach(function(app) {
          //add into email
          $q.all(
            accountsAPI.user.put(getEmail(), {appname: app}),
            accountsAPI.user.delete(getUID(), {appname: app})
          ).then(checkForDone);
        });
      });
    } else done();
  };
  
  data.getDevsAppsWithEmail = function(done) {
    var email = getEmail();
    if(email) {
       accountsAPI.user.get(getEmail()).then(done);
    } else done([]);
  }

  data.getDevsApps = function(done) {
    data.uidToEmail(data.getDevsAppsWithEmail.bind(null, done));
  }
  
  data.getAppsSecret = function(app, done) {
    return accountsAPI.app.get(app);
  }

  function request(req_type, app, subject, body, endpoint, try_num) {
    var deferred = $q.defer();
    var url = atob(server) + app + (subject ? ('/' + subject) : '') + (endpoint ? ('/' + endpoint) : '');
    //console.log(req_type, ': ', url, ', body: ', body)
    var promise = $http({
      method: req_type,
      url: url,
      data: body || {},
      headers: {
        'Content-Type': 'application/json'
      }
    });

    promise.success(deferred.resolve);
    promise.error(function(data, error){
      if(error.response === ""){
        console.log(url + ' generated empty response.');
        if(try_num && try_num <= 5) request(req_type, app, subject, body, endpoint, try_num+1);
        else request(req_type, app, subject, body, endpoint, 1);
      } else deferred.reject(error);
    });

    deferred.promise.catch(sentry);
    deferred.promise['error'] = deferred.promise['catch'];
    deferred.promise['success'] = deferred.promise['then'];
    return deferred.promise;
  }

  return data;
}

})();

(function(){
angular
.module('AppbaseDashboard')
.controller('invite', InviteCtrl);

function InviteCtrl($routeParams, utils, $scope, session, $rootScope, $location, $timeout) {
  if ($scope.devProfile = session.getProfile()) {
    Appbase.credentials("appbase_inviteafriend", "0055eb35f4217c3b4b288250e3dee753");

    var userProfile = $scope.devProfile;
    var email = userProfile.email.replace('@', '').replace('.', '');
    var usersNS = Appbase.ns("users");
    var inviteNS = Appbase.ns("sentinvites");
    var userV = usersNS.v(email);
    var inviteLink = ['https://appbase.io/?utm_campaign=viral&utm_content=', btoa(userProfile.email), '&utm_medium=share_link&utm_source=appbase'].join('');

    $("#subject").val('You have been invited to try Appbase by ' + userProfile.email)
    $('#invite-link').val(inviteLink);
    $('#link').val(inviteLink);
    $('#from').val(userProfile.email);

    $('#invited-users').on('click', '.resend', function(e) {
      $('#email').val($(this).data('email'));
      $('#form-invite-friends').submit();
      e.preventDefault();
    });

    userV.commitData(function(previousData) {
      if (!previousData.invites) {
        newData = {
          invites: 0
        }
      } else {
        newData = previousData;
      }
      return newData;
    }, function(error, vref) {
      //do nothing
    });

    userV.on('edge_added', function onComplete(err, vref, eref) {
      if (err) {
        //console.log(err);
      } else {
        vref.isValid(function(err, bool) {
          if (bool) {
            vref.on('properties', function(err, ref, userSnap) {
              if (err) {
                //console.log(err);
              } else {
                if (!$('#' + eref.priority()).length) {
                  $('#invited-users').append('<li id="' + eref.priority() + '"">' + userSnap.properties().email + ': <span class="pull-right resend-link"></span> <em class="status">' + userSnap.properties().status + '<em> <span class="pull-right resend-link"></span>');
                  if (userSnap.properties().status == 'invited') {
                    $('#' + eref.priority() + ' > .resend-link').html('<a class="resend" href="#" data-email="' + userSnap.properties().email + '" >Resend Invitation</a>');
                  }
                } else {
                  $('#' + eref.priority() + ' > .status').text(userSnap.properties().status);
                  if (userSnap.properties().status == 'registered') {
                    $('#' + eref.priority() + ' > .resend-link').remove();
                  }
                }
              }
            });
          }
        });
      }
    });

    $('#form-invite-friends').on('submit', function(event) {
      //$('#final-text').val([$('#text').val(),'<br><br> <a href="',inviteLink,'">Click here to join Appbase now.</a> or open this link on your browser: ', inviteLink, '.'].join(''));
      $('#final-text').val($('#text').val());
      //send form data to server
      $.ajax({
        type: "POST",
        url: $(this).attr('action'),
        data: $(this).serialize(),
        dataType: 'json',
        beforeSend: function(jqXHR, settings) {
          $('#ajax-loader').hide().removeClass('hide').slideDown('fast');
          $('#email-error').html('');
        },
        complete: function() {
          $('#ajax-loader').hide();
        },
        success: function(data, status) {
          if (data.accepted) {
            data.accepted.forEach(function(element, index) {
              vertex = [email, element.replace(/@/g, '').replace('.', '')].join('');
              //create new invited vertex and edge it to user
              var inviteV = inviteNS.v(vertex);
              inviteData = {
                status: 'invited',
                email: element
              }

              inviteV.setData(inviteData, function(error, vref) {
                userV.setEdge(vref.name(), inviteV);
                $('#email-sent').html(['<li>Invitation sent to: ', element, '</li>'].join(''));
              });

            });
          } else if (data.rejected) {
            data.accepted.forEach(function(element, index) {
              $('#email-error').append(['<li>', element, '</li>'].join(''));
            });
          } else {
            if (data.error) {
              $('#email-error').html(['<li>', data.message, '</li>'].join(''));
            } else {
              $('#email-error').html('<li>An error has happened.</li>');
            }

          }
        }
      });
      event.preventDefault();
    });
  }
}

})();
(function(){
angular
.module('AppbaseDashboard')
.factory('nodeBinding',['data', '$location', 'utils','$timeout',
  '$appbase','$rootScope','session','ngDialog', '$route', NodeBinding]);

function NodeBinding(data, $location, utils, $timeout, $appbase, $rootScope, session, ngDialog, $route) {
  var nodeBinding = {};
  nodeBinding.creating = [];
  function addNamespaces(node, childName) {
    for(var i=0 ; i<node.children.length; i++) {
       if(node.children[i].name === childName) {
         return true;
       }
    }
    return false;
  }

  nodeBinding.bindAsRoot = function($scope) {    
    var root = {isR: true};
    root.name = utils.getBaseUrl();
    
    root.meAsRoot = function() {
      session.setBrowserURL(utils.pathToUrl(''));
      $route.reload();
    }

    root.expand = function() {
      root.children = [];
      root.expanded = true;
      root.loading = true;
      pollNamespaces(function(){
        root.loading = false;
      });
      var polling = setInterval(pollNamespaces, 2000);
      $scope.$on('$destroy', function(){
        clearInterval(polling);
      });
    };

    root.contract = function(){
      root.expanded = false;
      root.children = [];
    }
    var initialPoll = true;
    function pollNamespaces(cb){
      data.getNamespaces().then(function(namespaceObjs){
        $timeout(function() {
          // removes old ones. saves the indexes to avoid modifying looping array
          var toRemove = [];
          if(root.children) {
            root.children.forEach(function(each, index){
              var found = false;
              namespaceObjs.forEach(function(obj){
                if(each.name === obj.name) {
                  found = true;
                  return;
                }
              });
              if(!found && nodeBinding.creating.indexOf(each.name) === -1) {
                toRemove.push(index);
              }
            });
            toRemove.forEach(function(each){
              root.children.splice(each, 1);
              $('.tooltip.fade.top').remove();
            });
          }
          //adds new ones
          namespaceObjs.forEach(function(nsObj) {
            if(nodeBinding.creating.indexOf(nsObj.name) !== -1) {
              nodeBinding.creating.splice(nodeBinding.creating.indexOf(nsObj.name), 1);
            }
            if(!addNamespaces(root, nsObj.name)) {
              var p = root.children.push(nodeBinding.bindAsNamespace($scope,nsObj.name));
              if(!initialPoll) {
                p--;
                $timeout(function(){
                  root.children[p]['added'] = true;
                });

                $timeout(function(){
                  root.children[p]['added'] = false;
                }, 1100);
              }
            }
          });
          initialPoll = false;
        });
        if(cb) cb();
      });
    }

    return root
  }
  
  var vertexBindCallbacks = {
    onAdd :function(scope, vData, vRef, done) {
      nodeBinding.bindAsVertex(scope, vRef.path(), vData);
      $timeout(function(){
        vData.added = true;
      });
      done();

      $timeout(function() {
        vData.added = false;
      }, 1100);
    },
    onUnbind : function(scope, vData, vRef) {
      vData.ref && vData.ref.unbind();
    },
    onRemove : function(scope, vData, vRef, done) {
      $timeout(function() {
        vData.removed = true;
        $('.tooltip.fade.top').remove();
      });
      $timeout(function() {
        done();
      }, 1100)
    },
    onChange : function(scope, vData, vRef, done) {
      $timeout(function(){
        vData.mod = true;
      });
      done();

      $timeout(function() {
        vData.mod = false;
      }, 1100);
    }
  }

  nodeBinding.bindAsNamespace = function($scope, namespace) {
    nodeBinding.creating.push(namespace);
    var ns =  {name: namespace, isNS: true, ref: $appbase.ns(namespace)}
    ns.meAsRoot = function() {
      session.setBrowserURL(utils.pathToUrl(namespace));
      $route.reload();
    }
    ns.expand = function() {
      ns.expanded = true;
      ns.loading = true;
      ns.children = ns.ref.bindVertices($scope, $.extend({}, vertexBindCallbacks, { onComplete: function(){
        $timeout(function(){
          ns.loading = false;
        });
      }}));
    }
    ns.contract = function() {
      ns.expanded = false;
      ns.ref.unbindVertices();
    }

    var ignoreToggleClick = false;

    ns.remove = function() {
      ns.deleting = true;
      data.deleteNamespace(ns.name, function(error){
        if(error) sentry(error);
        ns.deleting = false;
      });
    }

    return ns
  }

  nodeBinding.bindAsVertex = function($scope, path, useThisVertex) {
    $scope.stringify = function(v) {
      if(angular.isObject(v)) {
        try {
          v = JSON.stringify(v);
        } catch(e) {};
      }
      return v;
    }
    var parsedPath = utils.parsePath(path);
    var vertex;

    try {
      vertex = useThisVertex || {
        ref: $appbase.ns(parsedPath.ns).v(parsedPath.v)
      }
    } catch(e) {
      if(e.indexOf('Invalid arguments provided') !== -1) {
        session.setBrowserURL('');
        $route.reload();
        return;
      }
    }
    
    vertex.isV = true
    vertex.page = 0;

    vertex.nextPage = function(){
      if(vertex.children.length === 25) {
        vertex.page++;
        vertex.expand();
      }
    }

    vertex.prevPage = function(){
      if(vertex.page > 0) {
        vertex.page--;
        vertex.expand();
      }
    }

    vertex.expand = function() {
      vertex.expanded = true;
      vertex.loading = true;
      vertex.children=vertex.ref.bindEdges($scope,$.extend({},vertexBindCallbacks,{onComplete: function(a){
        $timeout(function(){
          vertex.loading = false;
        });
      }}), function(){}, {limit: 25, skip: vertex.page * 25 });
    }

    vertex.meAsRoot = function() {
      session.setBrowserURL(utils.pathToUrl(path));
      $route.reload();
    }

    vertex.contract = function() {
      vertex.expanded = false;
      vertex.ref.unbindEdges();
    }

    vertex.removeProperty = function(prop, done) {
      vertex.removingProp = prop;
      vertex.ref.removeData([prop], function(error){
         if(error) sentry(error);
         $timeout(function(){vertex.removingProp = false;});
         if(done) done();
      });
    }

    vertex.removeSelfEdge = function() {
      vertex.deleting = true;
      var isARootVertex = (utils.parsePath(path).obj_path === undefined);
      isARootVertex? vertex.ref.destroy() : vertex.ref.inVertex().removeEdge(vertex.name);
      //destroy if root vertex, remove edge if not
    }

    vertex.addProp = function(){
      ngDialog.open({
        template: '/developer/html/prop.html',
        controller: ['$scope', function($dialogScope) {
          $dialogScope.done = function() {
            if($dialogScope.prop && $dialogScope.val){
              vertex.addProperty($dialogScope.prop, $dialogScope.val);
              $dialogScope.closeThisDialog();
            }
          }
        }],
        className: 'ngdialog-theme-dialog-small'
      });
    }

    vertex.editProp = function(prop, val){
      ngDialog.open({
        template: '/developer/html/prop.html',
        controller: ['$scope', function($dialogScope) {
          $dialogScope.prop = prop;
          $dialogScope.val = val;
          $dialogScope.done = function() {
            if($dialogScope.prop && $dialogScope.val){
              if($dialogScope.prop !== prop){
                vertex.removeProperty(prop, function(){
                  vertex.addProperty($dialogScope.prop, $dialogScope.val);
                  $dialogScope.closeThisDialog();
                });
              } else {
                vertex.addProperty($dialogScope.prop, $dialogScope.val);
                $dialogScope.closeThisDialog();
              }
            }
          }
        }],
        className: 'ngdialog-theme-dialog-small'
      });
    }

    vertex.addProperty = function(prop, value) {
      var vData = {};
      vData[prop] = value;
      vertex.ref.setData(vData, function(){
        $scope.$apply();
      });
    }

    if(useThisVertex === undefined) {
      vertex.properties = vertex.ref.bindProperties($scope, {
        onProperties : function(scope, properties, ref, done) {
          if(vertex.color == 'white')
            vertex.color = 'gold';
          done();

          $timeout(function() {
            vertex.color = 'white';
          }, 500);
        }
      })
      vertex.name = path.slice(path.lastIndexOf('/') + 1);
    }

    /* Future programmer: do not mess with this. You have no idea what you're getting into. 
     * If you feel like optimizing something, I can point you to the minified file of the AngularJS library;
     * it's actually safer to mess with stuff from there. Employ your adventurous spirit somewhere else.
     * Consider yourself warned.
     */
    var uuid = 'a' + Appbase.uuid();
    var initial = true;
    vertex.ref.bindProperties($scope, {
      onProperties : function(scope, properties, ref, done) {
        $timeout(function() {
          if(!initial) {
            vertex.propchange = true;
            $timeout(function(){
              vertex.propchange = false;
            }, 2000);
          }
          initial = false;
          $scope[uuid] = vertex.properties = properties;
        });
      }
    })
    $scope.$watch(uuid, function(val){
      if(!val) return;
      vertex.hasProps = Object.keys($scope[uuid]).length>0;
    });
    
    return vertex;
  }
  nodeBinding.addNamespaces = addNamespaces;
  return nodeBinding;
}

})();
(function(){
angular
.module('AppbaseDashboard')
.controller('oauth', OauthCtrl)
.factory('oauthFactory', OauthFactory)
.factory('OauthBuild', OauthBuild);

function OauthBuild(oauthFactory, utils, Apps, $q, Loader) {
  var scope = {};

  var retObj = {
    build: function(appName) {
      Loader(25);
      var deferred = $q.defer();
      Apps.appFromName(appName).then(function(app){
        oauthFactory.getProviders().then(function(data){
          var arr = [];
          data.forEach(function(provider){
            var url = oauthFactory.getOauthdConfig().url;
            provider.data.logo =  url + 'providers/' + provider.data.provider + '/logo';
            arr.push(provider.data);
          });
          scope.providers = arr;
        }, sentry);

        scope.app = appName;
        scope.domains = [];
        scope.userProviders = {};
        
        app.$secret().then(function(){
          oauthFactory.getApp(app.name, app.secret).then(function(data){
            app.oauth = data.data;
            Loader(75);
            processOauth(app.oauth, deferred);
          }, deferred.reject);
        });

      });
      
      return deferred.promise;
    },
    get: function(){
      return scope;
    }
  }
  
  function processOauth(oauth, deferred){
    if(oauth.status) oauth = oauth.data;

    oauth.domains = oauth.domains || [];
    scope.domains = oauth.domains;

    if(scope.domains.indexOf('127.0.0.1')===-1) scope.domains.push('127.0.0.1');
    if(scope.domains.indexOf('localhost')===-1) scope.domains.push('localhost');
    scope.expiryTime = oauth.tokenExpiry || 1000*60*60*24*30;

    oauthFactory.getKeySets(scope.app, oauth.keysets || [])
    .then(function(data){
      scope.userProviders = data;
      deferred.resolve();
    });

  }

  return retObj;
}

function OauthCtrl($scope, OauthBuild, $filter, oauthFactory, $timeout, Loader){
  Loader(100);
  var obj = OauthBuild.get();

  Object.getOwnPropertyNames(obj).forEach(function(prop){
    $scope[prop] = obj[prop];
  });

  $scope.cancel = function(){
    $scope.editing = $scope.adding = false;
    $scope.clientID = '';
    $scope.clientSecret = '';
  }

  $scope.cancel();

  $scope.callbackDomain = oauthFactory.getOauthdConfig().oauthd;
  $scope.callbackURL = oauthFactory.getOauthdConfig().oauthd + oauthFactory.getOauthdConfig().authBase;
  
  $scope.sorter = function(prov){
    return $scope.userProviders[prov.provider]? true: false;
  };
  
  $scope.removeDomain = function(domain){
    $scope.loading = true;
    $scope.domains.splice($scope.domains.indexOf(domain), 1);
    oauthFactory.updateDomains($scope.app, $scope.domains)
    .then(function(data){
      if(data.status !== "success") {
        sentry(data);
        throw new Error(data);
      }
      $timeout(function(){
        $scope.loading = false;
      });
    }, sentry);
  };

  $scope.addDomain = function(domain){
    if($scope.domains.indexOf(domain) !== -1){
      $scope.domainInput = '';
      return;
    }
    $scope.loading = true;
    $scope.domains.push(domain);
    if($scope.domains.indexOf('127.0.0.1')===-1) $scope.domains.push('127.0.0.1');
    if($scope.domains.indexOf('localhost')===-1) $scope.domains.push('localhost');
    oauthFactory.updateDomains($scope.app, $scope.domains)
    .then(function(data){
      if(data.status !== "success") {
        sentry(data);
        throw new Error(data);
      };
      $timeout(function(){
        $scope.loading = false;
        $scope.domainInput = '';
      });
    }, sentry);
  };

  $scope.removeProvider = function(provider){
    $scope.loadingProv = true;
    oauthFactory.removeProvider($scope.app, provider)
    .then(function(data){
      if(data.status !== "success") {
        sentry(data);
        throw new Error(data);
      };
      $timeout(function(){
        delete $scope.userProviders[provider];
        $scope.loadingProv = false;
      });
    }, sentry);
  };

  $scope.add = function(provider){
    $scope.provider = provider;
    $scope.editing = $scope.adding = true;
  };

  $scope.edit = function(provider) {
    $scope.provider = provider;
    $scope.clientID = $scope.userProviders[provider.provider].parameters.client_id;
    $scope.clientSecret = $scope.userProviders[provider.provider].parameters.client_secret;
    $scope.editing = true;
    $scope.adding = false;
  }

  $scope.done = function(){
    $scope.editing = $scope.adding = false;
    if(!$scope.app || !$scope.provider.provider || !$scope.clientID || !$scope.clientSecret){
      throw new Error('Missing information');
    };
    $scope.loadingProv = true;
    oauthFactory.addProvider($scope.app, $scope.provider.provider, $scope.clientID, $scope.clientSecret)
    .then(function(data){
      $timeout(function(){
        var obj = {
          response_type: 'code',
          parameters: {
            client_id: $scope.clientID,
            client_secret: $scope.clientSecret
          }
        };
        $scope.loadingProv = false;
        $scope.userProviders[$scope.provider.provider] = obj;
        $scope.clientID = $scope.clientSecret = '';
      });
    }, sentry);
  };

  $scope.validate = function(time){
    var minTime = 1000*60*60, maxTime = 1000*60*60*24*60;
    var valid = {'s':1000, 'm':1000*60, 'h':1000*60*60, 'd':1000*60*60*24, 'w':1000*60*60*24*7};
    if(/^[0-9]{1,}[smhdw]{1}$/.test(time)){
      for(var prop in valid){
        if(time.indexOf(prop) !== -1){
          var inMs = time.split(prop)[0] * valid[prop];
          return (inMs <= maxTime && inMs >= minTime) ? inMs : false;
        }
      }
    }
    return false;
  };

  $scope.updateExpiry = function(time){    
    if($scope.validate(time)){
      $scope.loading = true;
      oauthFactory.updateTime($scope.app, $scope.validate(time))
      .then(function(data){
        if(data.status !== "success") {
          sentry(data);
          throw new Error(data);
        }
        $timeout(function(){
          $scope.expiryTime = $scope.validate(time);
          $scope.loading = false;
          $scope.timeInput = '';
        });
      }, sentry);
    }
  };

  $scope.readTime = function(ms){
    var seconds, minutes, hours, days, rest;
    seconds = minutes = hours = days = rest = 0;
    var x = ms / 1000;
    seconds = x % 60;
    x /= 60;
    minutes = x % 60;
    x /= 60;
    hours = x % 24;
    x /= 24;
    days = x;
    days -= days%1;
    hours -= hours%1;
    minutes -= minutes%1;
    seconds -= seconds%1;
    
    return (days>=1 ? days + (' day' + (days>1?'s ':' ')) : '')
         + (hours ? hours + (' hour' + (hours>1?'s ':' ')) : '')
         + (minutes ? minutes + (' minute' + (minutes>1?'s ':' ')) : '')
         + (seconds ? seconds + (' second' + (seconds>1?'s ':' ')) : '');
  };
}

function OauthFactory($timeout, $q, $http){
  var oauth = {};
  var config = { 
    oauthd: "https://auth.appbase.io",
    authBase: "/",
    apiBase: "/api/"
  };
  var base_url = config.url = config.oauthd + config.apiBase;
  var providers = [{ name: 'google'},
                   { name: 'facebook'},
                   { name: 'linkedin'},
                   { name: 'dropbox'},
                   { name: 'github'}];


  oauth.getOauthdConfig = function() {
    return config;
  }

  var oauthAPI = oauth.oauthAPI = (function(){
    var points = ['apps', 'providers'];
    var methods = ['get', 'post', 'patch', 'put', 'delete'];
    var retObj = {};

    function req(method, point, subject, endpoint, body){
      if(angular.isObject(endpoint)) {
        body = endpoint;
        endpoint = '';
      }
      if(!endpoint) endpoint = '';
      if(!body) body = '';
      return request(method, point, subject, body, endpoint);
    }

    points.forEach(function(point){
      methods.forEach(function(method){
        retObj[point] = retObj[point] || {};
        retObj[point][method] = function(subject, endpoint, body){
          return req(method, point, subject, endpoint, body);
        };
      });
    });

    return retObj;
  })();
  
  oauth.createApp = function(appName, secret, domains){
    return oauthAPI.apps.post('', '', {
      name: appName,
      domains: domains,
      secret: secret,
      tokenExpiry: 1000*60*60*24*30
    });
  };

  oauth.getApp = function(appName, secret){
    var deferred = $q.defer();

    oauthAPI.apps.get(appName).then(deferred.resolve, function(data){
      if(data === 500){
        oauth.createApp(appName, secret, ['localhost', '127.0.0.1'])
        .then(deferred.resolve, deferred.reject);
      } else {
        deferred.reject(data);
      }
    });

    return deferred.promise;
  };

  oauth.updateDomains = function(appName, domains){
    return oauthAPI.apps.post(appName, {domains: domains});
  };

  oauth.getProviders = function(){
    var promises = [];
    providers.forEach(function(provider){
      promises.push(oauthAPI.providers.get(provider.name));
    });
    return $q.all(promises);
  };

  oauth.getKeySets = function(app, appProviders){
    var deferred = $q.defer();
    var promises = [];
    var providers = {};

    appProviders.forEach(function(appProvider){
      var promise = oauthAPI.apps.get(app, 'keysets/' + appProvider).then(function(result){
        providers[appProvider] = result.data;
      });
      promises.push(promise);
    });

    $q.all(promises).then(function(){
      deferred.resolve(providers);
    });

    return deferred.promise;
  };

  oauth.removeProvider = function(app, provider){
    return oauthAPI.apps.delete(app, 'keysets/' + provider);
  };

  oauth.addProvider = function(app, provider, client, secret){
    return oauthAPI.apps.post(app, 'keysets/' + provider, {
      response_type: 'code',
      parameters: {
        client_id: client,
        client_secret: secret
      }
    });
  };

  oauth.updateTime = function(appName, time){
    return oauthAPI.apps.post(appName, '', {tokenExpiry: time});
  }

  return oauth;

  function request(req_type, app, subject, body, endpoint, try_num) {
    var deferred = $q.defer();
    var url = base_url + app + (subject ? ('/' + subject) : '') + (endpoint ? ('/' + endpoint) : '');
    //console.log(req_type, ': ', url, ', body: ', body)
    var promise = $http({
      method: req_type,
      url: url,
      data: body || {},
      headers: {
        'Content-Type': 'application/json'
      }
    });

    promise.success(deferred.resolve);

    promise.error(function(data, error){
      if(error.response === ""){
        console.log(url + ' generated empty response.');
        if(try_num && try_num <= 5) request(req_type, app, subject, body, endpoint, try_num+1);
        else request(req_type, app, subject, body, endpoint, 1);
      } else deferred.reject(error);
    });

    deferred.promise.catch(sentry);
    deferred.promise['error'] = deferred.promise['catch'];
    deferred.promise['success'] = deferred.promise['then'];
    return deferred.promise;
  }
}


})();
(function(){

angular
.module('AppbaseDashboard')
.config(['$routeProvider', '$locationProvider', Routes])
.controller('start', Start)
.factory('Loader', Loader);

function Loader($rootScope, $timeout) {
  return function(progress){
    $timeout(function(){
      $rootScope.loadLine = progress;
    });
  }
}

function Start(session, $location, Apps) {
  var user = session.getProfile();
  var lastApps = Apps.get();

  if(lastApps.length) {
    var lastApp = lastApps[0].name;
    $location.path(lastApp + '/dash');
  } else {
    $location.path('/apps');
  }

  // http://bootstraptour.com/api/#step-options
  // var tour = new Tour({
  //   steps: [
  //   {
  //     element: "#my-element",
  //     title: "Title of my step",
  //     content: "Content of my step",
  //     onNext: func
  //   },
  //   {
  //     element: "#my-other-element",
  //     title: "Title of my step",
  //     content: "Content of my step"
  //   }
  // ]});

  // tour.init();
  // tour.start();

  // if(!user || !apps.length) {
  // } else console.log(apps)
}

function Routes($routeProvider, $locationProvider){

  var controllers = [
    {
      name: 'start',
      path: '/'
    }, {
      name: 'apps',
      path: '/apps'
    }, {
      name: 'browser',
      path: '/:app/browser'
    }, {
      name: 'dash',
      path: '/:app/dash',
      resolve: {
        build: function(DashboardBuild, $route) {
          return DashboardBuild.build($route.current.params.app);
        }
      }
    }, {
      name: 'oauth',
      path: '/:app/oauth',
      resolve: {
        build: function(OauthBuild, $route) {
          return OauthBuild.build($route.current.params.app);
        }
      }
    }, {
      name: 'invite',
      path: '/invite'
    }, {
      name: 'billing',
      path: '/billing'
    }
  ];

  var baseUrl = '/developer/html/';
  controllers.forEach(function(controller){
    var routeObj = {
      controller: controller.name,
      templateUrl: baseUrl + controller.name + '.html'
    };
    if(controller.resolve) routeObj.resolve = controller.resolve;
    $routeProvider.when(controller.path, routeObj);
  });

  $routeProvider.when('/login', { templateUrl: baseUrl + 'login.html'});


  $routeProvider.otherwise( { redirectTo: '/' } );

  if(!window.localEnv) $locationProvider.html5Mode(true).hashPrefix('!');

}

})();
(function(){
angular
.module('AppbaseDashboard')
.factory('session', ['utils', '$rootScope', 'data', '$q', SessionFactory]);

function SessionFactory(utils, $rootScope, data, $q){
  var session = {};

  var writing = false;

  session.setApps = function(apps){
    if(writing) $rootScope.$on('doneWriting', function(){
      session.setApps(apps);
    });
    else {
      writing = true;
      setApps(apps);
    }
  }

  function setApps(apps) {
    apps = angular.isArray(apps) ? apps : [];

    var newArray = [];
    apps.forEach(function(app){
      var obj = { name: app.name };
      if(app.secret) obj.secret = app.secret;
      newArray.push(obj);
    });
    
    sessionStorage.setItem('apps', JSON.stringify(newArray));

    writing = false;
    $rootScope.$broadcast('doneWriting');
  };

  session.getApps = function() {
    if(session.getProfile()){
      var apps = sessionStorage.getItem('apps');
      return apps? JSON.parse(apps) : [];
    } else return [];
  };

  session.fetchApps = function() {
    var deferred = $q.defer();

    data.getDevsApps(function(apps){
      var order = [];
      var existing = session.getApps();
      var first = !existing.length;
      
      if(first){
        var profile = session.getProfile();
        if(profile) {
          var localOrder = localStorage.getItem(profile.uid + 'order');
          if(localOrder) order = JSON.parse(localOrder);
          else first = false;
        }
      } else {
        existing.forEach(function(app){
          order.push(app.name);
        });
      }

      //persists order after logout
      if(first){
        apps.sort(function(a,b){
          //if a is greater, a should go after
          //if a is new, a should go first
          if(!a || !b) return 0;
          var a_index = order.indexOf(a.name);
          if(a_index === -1) return -1000000;
          var b_index = order.indexOf(b.name);
          if(b_index === -1) return 1000000;
          return a_index - b_index;
        });
  		}

      var ordered = [];
      ordered.push.apply(ordered, order.filter(function(app) {
        return apps.some(function(received) {
          return received === app;
        });
      }));
      ordered.unshift.apply(ordered, apps.filter(function(newApp) {
        return ordered.every(function(orderApp) {
          return newApp !== orderApp;
        });
      }));

      //console.time('total')
      var obj = {
        email: 'unknown',
        name: 'unknown'
      };

      var user = session.getProfile() || obj;

      deferred.resolve(ordered);
    });
    return deferred.promise;
  }

  function filterFirst(array, desired){
  	var index = 0;
  	array.some(function(existing){
  		index++;
  		return existing === desired;
  	});
  	return index === array.length ? -1 : index-1;
  }

  session.setProfile = function(profile) {
    localStorage.setItem('devProfile', JSON.stringify(profile));
  };

  session.setBrowserURL = function(url) {
    sessionStorage.setItem('URL', url);
  };

  session.getBrowserURL = function(apps) {
    var URL;

    URL = sessionStorage.getItem('URL');
    if(URL === null){
      URL = apps ? utils.appToURL(apps[0].name) : undefined;

    }
    return URL;
  };

  session.getProfile = function() {
    return JSON.parse(localStorage.getItem('devProfile'));
  };

  return session;
}


})();
(function(){
angular
.module('AppbaseDashboard')
.controller('sharingCtrl', SharingCtrl);

function SharingCtrl($scope, $rootScope, data, $timeout, session, $routeParams){
  var app;

  $scope.addUser = function(){
    var email = session.getProfile().email;
    var adding = $scope.input;
    app = app || $routeParams.app;
    $scope.refreshing = true;

    data.accountsAPI.app.get(app, 'owners').then(function(owners){
      if(owners.indexOf(email) !== -1) {
        var user = data.putUser(app, adding).catch(sentry);
        var application = data.putApp(adding, app).catch(sentry);

        user.then(function(){
          application.then(function(){
            getUsers(owners);
          });
        });
      } else {
        $timeout(function(){
          $scope.refreshing = false;
        });
      }
    });

  };

  $rootScope.share = function(_app){
    $scope.loading = true;
    app = _app;
    var email = session.getProfile().email;

    $rootScope.sharing = true;
    $scope.owner = false;
    $scope.email = email;

    getUsers();
  }

  $scope.delete = function(user){
    app = app || $routeParams.app;
    $scope.refreshing = true;
    data.deleteUser(app, user).catch(sentry).then(function(){
      getUsers();
    });
  }

  function getUsers(owners){
    var users = data.accountsAPI.app.get(app, 'users');

    if(!owners) data.accountsAPI.app.get(app, 'owners').then(process);
    else process(owners);

    function process(owners) {
      var email = session.getProfile().email;
      if(owners.indexOf(email) !== -1) {
        $scope.owner = true;
        $scope.placeholder = 'Add new user email';
      } else {
        $scope.placeholder = 'You must own the app to add users';
      }
      users.then(function(users){
        owners.forEach(function(owner){
          if(users.indexOf(owner) === -1) {
            users.unshift(owner);
          }
        });
        $timeout(function(){
          $scope.users = users;
          $scope.refreshing = false;
          $scope.loading = false;
          $scope.input = '';
        });
      });
    }
  }
}

})();

// (function(){
// angular
// .module('AppbaseDashboard')
// .controller('navbar', NavbarCtrl);


// function NavbarCtrl($rootScope, $scope, session){
//   if($scope.devProfile = session.getProfile()) {
//     Appbase.credentials("appbase_inviteafriend", "0055eb35f4217c3b4b288250e3dee753");
//     var userProfile = JSON.parse(localStorage.getItem('devProfile'));
//     var email = userProfile.email.replace('@','').replace('.','');
//     var usersNS = Appbase.ns("users");
//     var inviteNS = Appbase.ns("sentinvites");
//     var userV = usersNS.v(email);

//     userV.on('properties', function (err,ref,userSnap) {
//       if(userSnap && userSnap.properties() && userSnap.properties().invites){
//         $('#user-balance').html([userSnap.properties().invites,'.1M'].join(''));
//         $rootScope.balance = (userSnap.properties().invites * 1000000) + 100000 ;
//       }
//       else{
//         $('#user-balance').html('100K');
//         $rootScope.balance = 100000;
//       }
//       $rootScope.$apply();
//     });
//   }
// }

// })();
(function(){
angular
.module('AppbaseDashboard')
.controller('topnav', TopNavCtrl);

function TopNavCtrl($scope, $routeParams, Apps, $timeout, data, $location, Loader, $rootScope) {
  var appName, secret;

  $scope.routeParams = $routeParams;
  $scope.where = $location.path().split('/')[2];

  Apps.appFromName($scope.routeParams.app).then(function(app){
    app.$version().then(function(){
      $timeout(function(){
        $rootScope.version = app.version;
      });
    });

    app.$secret().then(function(){
      $timeout(function(){        
        $scope.secret = secret = app.secret;
      });
    });
  });

  $scope.deleteApp = function(app){
    Loader(10);
    Apps.appFromName(app).then(function(appObj){
      appObj.$secret().then(function(){
        data.deleteApp(app, appObj.secret).then(function(){
          $timeout(function(){
            $location.path('/apps');
          });
        }).catch(function(error){
          sentry(error);
        });
      });
    });
  }

}

})();
(function(){
angular
.module('AppbaseDashboard')
.factory('utils', utilsFactory);

function utilsFactory(){
  var utils = {};
  var baseUrl;

  utils.appNamesToObj = function(_apps){
    var retArr = [];
    _apps.forEach(function(app){
      retArr.push({name: app});
    });
    return retArr;
  };

  utils.appObjToNames = function(_apps){
    var retArr = [];
    _apps.forEach(function(app){
      retArr.push(app.name);
    });
    return retArr;
  };

  utils.setBaseUrl = function(bUrl){
    baseUrl = bUrl;
  };

  utils.getBaseUrl = function(bUrl){
    return baseUrl;
  };

  utils.urlToAppname = function(url) {
    return utils.parseURL(url).appName;
  };

  utils.urlToPath = function(url) {
    return utils.parseURL(url).path;
  };

  utils.pathToUrl = function(path) {
    return baseUrl + path;
  };
  
  utils.parsePath = function(path) {
    return utils.parseURL(utils.pathToUrl(path));
  };

  utils.parseURL = function(url) {
    if(!url) return {}; //return empty object for undefined
    var intermediate, appname, version, path, namespace, key, obj_path, v;
    intermediate = url.split(/\/\/(.+)?/)[1].split(/\.(.+)?/);
    intermediate = intermediate[1].split(/\/(.+)?/)[1].split(/\/(.+)?/);
    appname = intermediate[0];
    intermediate = intermediate[1].split(/\/(.+)?/);
    version = intermediate[0];
    path = intermediate[1];
    if(path) {
      intermediate = path.split(/\/(.+)?/);
      namespace = intermediate[0];
      v = intermediate[1];
      key;
      obj_path;
      if(v) {
        intermediate = v.split(/\/(.+)?/);
        key = intermediate[0];
        obj_path = intermediate[1];
      }
    }
    var retObj = {
      appName: appname,
      ns: namespace,
      key: key,
      obj_path: obj_path,
      path: path,
      v: v
    }
    return retObj;
  }

  utils.cutLeadingTrailingSlashes = function(input) {
    if(typeof input !== 'string')
      return
    while(input.charAt(input.length - 1) === '/') {
      input = input.slice(0,-1);
    }
    while(input.charAt(0) === '/') {
      input = input.slice(1);
    }
    return input;
  };

  utils.parentUrl = function(url) {
    var parentPath = utils.parentPath(utils.urlToPath(url));
    return utils.pathToUrl(parentPath);
  };

  utils.parentPath = function(path) {
    var slashI;
    return path === undefined? '': path.slice(0, (slashI = path.lastIndexOf('/')) === -1? 0: slashI);
  };

  utils.appToURL = function(app) {
    return 'https://api.appbase.io/' + app + '/v2_1/';
  };

  return utils;
}

})();